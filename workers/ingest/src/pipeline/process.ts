import { sql } from 'kysely'
import {
  StaleTransitionError,
  contentHash,
  errorFields,
  recordSpend,
  setItemEmbedding,
  toVectorLiteral,
  getPipelinePause,
  paperEvidenceTexts,
  parseItemImages,
  transitionItem,
  type Database,
  type ItemImage,
  type ItemStatus,
  type Logger,
  type ParsedPaper,
} from '@reelset/core'
import { EMBED_BATCH_SIZE } from '../config'
import type { RenderJobMessage } from '../env'
import {
  approxTokens,
  embeddingCostUsd,
  llmCostUsd,
  parseModelOutput,
  type Embedder,
  type LlmClient,
} from './gemini'
import {
  buildEvidenceRows,
  hasEnoughEvidence,
  parseExtraTexts,
  selectPromptChunks,
  stageFor,
  youtubeIdFromKey,
} from './decide'
import { captureItemImages } from '../images'
import { pdfMarkdownEvidence } from '../arxiv-html'
import { arxivIdFromKey, type PaperClient } from '../paper-client'
import type { ScrapeFallback } from '../types'
import { paperAssetsPrompt, resolvePaperShots } from './paper-shots'
import { PROMPT_VERSION, SYSTEM_PROMPT, buildUserPrompt } from './prompt'
import { allowedImageSet, validateGenerated, type GeneratedContent } from './safety'
import type { TranscriptClient } from './transcript'

export type ProcessDeps = {
  db: Database
  log: Logger
  llm: LlmClient
  embedder: Embedder
  transcripts: TranscriptClient
  papers?: PaperClient
  scrape?: ScrapeFallback
  renderQueue: { send: (message: RenderJobMessage) => Promise<unknown> }
  geminiModel: string
  embeddingModel: string
  alertWebhookUrl?: string
  githubToken?: string
}

export type ProcessOutcome =
  | 'rendered_enqueued'
  | 'embedded'
  | 'insufficient_source'
  | 'generation_failed'
  | 'skipped_stale'
  | 'skipped_missing'
  | 'paused'

type ItemRow = {
  id: string
  canonical_key: string
  canonical_url: string
  kind: string
  title: string
  status: ItemStatus
  tldr: string | null
  topics: string[]
  queued_at: Date | null
  images: unknown
}

const GENERATION_ATTEMPTS = 2

async function loadItem(db: Database, itemId: string): Promise<ItemRow | undefined> {
  const row = await db
    .selectFrom('item')
    .select([
      'id',
      'canonical_key',
      'canonical_url',
      'kind',
      'title',
      'status',
      'tldr',
      'topics',
      'queued_at',
      'images',
    ])
    .where('id', '=', itemId)
    .executeTakeFirst()
  return row as ItemRow | undefined
}

export async function processItem(
  deps: ProcessDeps,
  itemId: string,
  deliveryAttempt: number,
): Promise<ProcessOutcome> {
  const log = deps.log.child({ itemId, deliveryAttempt })
  const item = await loadItem(deps.db, itemId)
  if (!item) {
    log.warn('item not found, acking')
    return 'skipped_missing'
  }

  const stage = stageFor(item.status)
  log.info({ status: item.status, stage }, 'processing item')
  if (stage === 'skip') return 'skipped_stale'
  if (stage === 'enqueue_render') return enqueueRender(deps, item, log)

  const pause = await getPipelinePause(deps.db, log)
  if (pause) {
    await releaseItem(deps.db, item.id)
    log.info({ until: pause.until }, 'pipeline paused, item released without counting an attempt')
    return 'paused'
  }

  if (stage === 'summarize') {
    const result = await summarize(deps, item, deliveryAttempt, log)
    if (result !== 'summarized') return result
    const fresh = await loadItem(deps.db, itemId)
    if (!fresh) return 'skipped_missing'
    return embedAndAdvance(deps, fresh, deliveryAttempt, log)
  }
  return embedAndAdvance(deps, item, deliveryAttempt, log)
}

export async function releaseItem(db: Database, itemId: string): Promise<void> {
  await db
    .updateTable('item')
    .set({ queued_at: null })
    .where('id', '=', itemId)
    .where('status', 'in', ['found', 'summarized'])
    .execute()
}

async function storeImages(
  deps: ProcessDeps,
  item: ItemRow,
  mentions: readonly { url: string }[],
  log: Logger,
  paper: ParsedPaper | null,
): Promise<ItemImage[]> {
  try {
    const images = await captureItemImages(
      {
        canonicalKey: item.canonical_key,
        canonicalUrl: item.canonical_url,
        mentionUrls: mentions.map((m) => m.url),
        paper,
      },
      { log, githubToken: deps.githubToken },
    )
    await deps.db
      .updateTable('item')
      .set({ images: JSON.stringify(images) })
      .where('id', '=', item.id)
      .where('images', 'is', null)
      .execute()
    return images
  } catch (err) {
    log.warn(errorFields(err), 'image capture failed, continuing without images')
    return []
  }
}

function paperTexts(paper: ParsedPaper | null, source: string): string[] | null {
  if (!paper || source !== 'papers') return null
  const texts = paperEvidenceTexts(paper)
  return texts.length > 0 ? texts : null
}

async function summarize(
  deps: ProcessDeps,
  item: ItemRow,
  deliveryAttempt: number,
  log: Logger,
): Promise<'summarized' | ProcessOutcome> {
  const { db } = deps
  const startedAt = performance.now()

  const mentions = await db
    .selectFrom('mention')
    .select(['id', 'source', 'external_id', 'url', 'title', 'body', 'raw'])
    .where('item_id', '=', item.id)
    .orderBy('published_at', 'asc')
    .execute()
  if (mentions.length === 0) throw new Error('item has no mentions')

  const arxivId = arxivIdFromKey(item.canonical_key)
  const paper = arxivId && deps.papers ? await deps.papers.parse(arxivId) : null
  let pdfTexts: string[] | null = null
  if (
    !paper &&
    arxivId &&
    deps.scrape &&
    mentions.every((m) => parseExtraTexts(m.raw).length === 0)
  ) {
    const markdown = await deps.scrape.scrape(`https://arxiv.org/pdf/${arxivId}`, 'paper_pdf')
    pdfTexts = markdown ? pdfMarkdownEvidence(markdown) : null
    log.info({ arxivId, chunks: pdfTexts?.length ?? 0 }, 'paper pdf fallback via firecrawl')
  }
  const images =
    item.images == null
      ? await storeImages(deps, item, mentions, log, paper)
      : parseItemImages(item.images)

  let transcript: string | null = null
  const videoId = youtubeIdFromKey(item.canonical_key)
  if (videoId) {
    const result = await deps.transcripts.fetch(videoId)
    if (result.status === 'unavailable' && result.reason === 'error') {
      log.warn({ videoId, deliveryAttempt }, 'transcript fetch failed, retrying')
      throw new Error(`transcript fetch failed for ${videoId}`)
    }
    if (result.status === 'unavailable') {
      log.warn(
        { videoId, reason: result.reason },
        'transcript unavailable, marking insufficient_source',
      )
      await transitionItem(
        db,
        {
          itemId: item.id,
          from: 'found',
          to: 'insufficient_source',
          attempt: deliveryAttempt,
          meta: { reason: result.reason, videoId },
        },
        log,
      )
      return 'insufficient_source'
    }
    transcript = result.text
  }

  const rows = buildEvidenceRows(
    mentions.map((m) => ({
      id: m.id,
      source: m.source,
      title: m.title,
      body: m.body,
      extraTexts:
        paperTexts(paper, m.source) ??
        (m.source === 'papers' ? pdfTexts : null) ??
        parseExtraTexts(m.raw),
    })),
    transcript,
  )
  if (!hasEnoughEvidence(rows)) {
    log.warn({ chunks: rows.length }, 'not enough source text, marking insufficient_source')
    await transitionItem(
      db,
      {
        itemId: item.id,
        from: 'found',
        to: 'insufficient_source',
        attempt: deliveryAttempt,
        meta: { reason: 'thin_evidence' },
      },
      log,
    )
    return 'insufficient_source'
  }

  await db
    .insertInto('evidence_chunk')
    .values(
      rows.map((r) => ({
        item_id: item.id,
        mention_id: r.mentionId,
        chunk_index: r.chunkIndex,
        text: r.text,
      })),
    )
    .onConflict((oc) => oc.columns(['mention_id', 'chunk_index']).doNothing())
    .execute()

  const stored = await db
    .selectFrom('evidence_chunk')
    .select(['id', 'text'])
    .where('item_id', '=', item.id)
    .orderBy('mention_id')
    .orderBy('chunk_index')
    .execute()
  const promptChunks = selectPromptChunks(stored)
  const chunkIds = new Set(stored.map((c) => c.id))
  const promptChunkIds = new Set(promptChunks.map((c) => c.id))
  const sourceText = [
    item.title,
    item.canonical_url,
    ...mentions.map((m) => `${m.url} ${m.title ?? ''}`),
    ...stored.map((c) => c.text),
  ].join('\n')
  const imageUrls = [
    ...allowedImageSet(
      mentions.map((m) => ({ source: m.source, externalId: m.external_id })),
      [...stored.map((c) => c.text), ...mentions.map((m) => m.body ?? '')],
    ),
  ]

  log.info({ chunks: stored.length, promptChunks: promptChunks.length }, 'evidence ready')

  let rejection: string | undefined
  let accepted: GeneratedContent | null = null

  for (let attempt = 1; attempt <= GENERATION_ATTEMPTS && !accepted; attempt++) {
    const llmStartedAt = performance.now()
    const result = await deps.llm.generate({
      system: SYSTEM_PROMPT,
      user: buildUserPrompt({
        title: item.title,
        kind: item.kind,
        canonicalUrl: item.canonical_url,
        chunks: promptChunks,
        imageUrls,
        paperAssets: paper ? paperAssetsPrompt(paper, images) : undefined,
        rejection,
      }),
    })
    await recordSpend(
      db,
      {
        category: 'llm',
        units: result.usage.inputTokens + result.usage.outputTokens,
        costUsd: llmCostUsd(result.usage),
        meta: { model: deps.geminiModel, itemId: item.id, attempt },
      },
      log,
    )
    log.info(
      {
        attempt,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        durationMs: Math.round(performance.now() - llmStartedAt),
      },
      'llm call done',
    )

    const parsed = parseModelOutput(result.text, promptChunkIds, sourceText)
    if (!parsed.ok) {
      rejection = parsed.reason
      log.warn({ attempt, reason: rejection }, 'model output rejected (parse)')
      continue
    }
    const verdict = validateGenerated({
      ...parsed.value,
      sourceText,
      chunkIds,
      allowedImageUrls: new Set(imageUrls),
    })
    if (!verdict.ok) {
      rejection = verdict.reasons.join('; ')
      log.warn({ attempt, reasons: verdict.reasons }, 'model output rejected (safety)')
      continue
    }
    accepted = parsed.value
  }

  if (!accepted) {
    await transitionItem(
      db,
      {
        itemId: item.id,
        from: 'found',
        to: 'failed',
        attempt: deliveryAttempt,
        error: `generation rejected: ${rejection ?? 'unknown'}`.slice(0, 500),
      },
      log,
    )
    return 'generation_failed'
  }

  const shotStats = resolvePaperShots(
    accepted.script as unknown as { beats?: unknown },
    paper,
    images,
  )
  if (shotStats.tables + shotStats.equations + shotStats.figures + shotStats.dropped > 0) {
    log.info(shotStats, 'paper shots resolved')
  }

  const hash = await contentHash([item.title, accepted.tldr, JSON.stringify(accepted.script)])
  await db.transaction().execute(async (trx) => {
    await trx
      .updateTable('item')
      .set({
        tldr: accepted.tldr,
        script: JSON.stringify(accepted.script),
        topics: accepted.topics,
        content_hash: hash,
        prompt_version: PROMPT_VERSION,
      })
      .where('id', '=', item.id)
      .where('status', '=', 'found')
      .execute()
    await transitionItem(
      trx,
      {
        itemId: item.id,
        from: 'found',
        to: 'summarized',
        attempt: deliveryAttempt,
        durationMs: Math.round(performance.now() - startedAt),
        meta: { promptVersion: PROMPT_VERSION, chunks: stored.length },
      },
      log,
    )
  })
  return 'summarized'
}

async function embedAndAdvance(
  deps: ProcessDeps,
  item: ItemRow,
  deliveryAttempt: number,
  log: Logger,
): Promise<ProcessOutcome> {
  const { db } = deps
  const startedAt = performance.now()

  const pending = await sql<{ id: string; text: string }>`
    select id, text from evidence_chunk
    where item_id = ${item.id} and embedding is null
    order by mention_id, chunk_index`.execute(db)

  for (let start = 0; start < pending.rows.length; start += EMBED_BATCH_SIZE) {
    const batch = pending.rows.slice(start, start + EMBED_BATCH_SIZE)
    const vectors = await deps.embedder.embed(batch.map((c) => c.text))
    await recordEmbeddingSpend(
      deps,
      batch.map((c) => c.text),
      item.id,
      log,
    )
    const literals = vectors.map((v) => toVectorLiteral(v))
    await sql`
      update evidence_chunk c set embedding = v.e::vector
      from unnest(${batch.map((c) => c.id)}::uuid[], ${literals}::text[]) as v(id, e)
      where c.id = v.id`.execute(db)
  }

  const itemText = [item.title, item.tldr ?? '', item.topics.join(', ')].join('\n')
  const [itemVector] = await deps.embedder.embed([itemText])
  if (!itemVector) throw new Error('embedder returned no vector for item')
  await recordEmbeddingSpend(deps, [itemText], item.id, log)
  await setItemEmbedding(db, item.id, itemVector, log)

  await db.transaction().execute(async (trx) => {
    await transitionItem(
      trx,
      {
        itemId: item.id,
        from: 'summarized',
        to: 'embedded',
        attempt: deliveryAttempt,
        durationMs: Math.round(performance.now() - startedAt),
        meta: { chunksEmbedded: pending.rows.length, model: deps.embeddingModel },
      },
      log,
    )
    await trx.updateTable('item').set({ queued_at: null }).where('id', '=', item.id).execute()
  })

  const fresh = await loadItem(db, item.id)
  if (!fresh) return 'embedded'
  return enqueueRender(deps, fresh, log)
}

async function recordEmbeddingSpend(
  deps: ProcessDeps,
  texts: readonly string[],
  itemId: string,
  log: Logger,
): Promise<void> {
  const tokens = approxTokens(texts)
  await recordSpend(
    deps.db,
    {
      category: 'embedding',
      units: tokens,
      costUsd: embeddingCostUsd(tokens),
      meta: { model: deps.embeddingModel, itemId },
    },
    log,
  )
}

async function enqueueRender(
  deps: ProcessDeps,
  item: ItemRow,
  log: Logger,
): Promise<ProcessOutcome> {
  if (item.queued_at !== null) {
    log.info('embedded item already queued for render, nothing to do')
    return 'embedded'
  }
  await deps.renderQueue.send({ itemId: item.id, attempt: 0 })
  await deps.db
    .updateTable('item')
    .set({ queued_at: sql`now()` })
    .where('id', '=', item.id)
    .where('status', '=', 'embedded')
    .execute()
  log.info('render job enqueued')
  return 'rendered_enqueued'
}

export async function failItemAfterRetries(
  deps: Pick<ProcessDeps, 'db' | 'log'>,
  itemId: string,
  deliveryAttempt: number,
  err: unknown,
): Promise<void> {
  const log = deps.log.child({ itemId, deliveryAttempt })
  const item = await loadItem(deps.db, itemId)
  if (!item) return
  if (item.status !== 'found' && item.status !== 'summarized' && item.status !== 'embedded') return
  try {
    await transitionItem(
      deps.db,
      {
        itemId,
        from: item.status,
        to: 'failed',
        attempt: deliveryAttempt,
        error: (err instanceof Error ? err.message : String(err)).slice(0, 500),
      },
      log,
    )
  } catch (inner) {
    if (inner instanceof StaleTransitionError) {
      log.info('item moved on before it could be failed')
      return
    }
    log.error(errorFields(inner), 'could not mark item failed')
  }
}
