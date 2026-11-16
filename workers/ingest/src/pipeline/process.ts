import { sql } from 'kysely'
import {
  MAX_SPOKEN_CHARS,
  StaleTransitionError,
  claudeCostUsd,
  contentHash,
  errorFields,
  recordSpend,
  setItemEmbedding,
  toVectorLiteral,
  getPipelinePause,
  paperEvidenceTexts,
  parseItemImages,
  type ClaudeModel,
  type Database,
  type ItemImage,
  type ItemStatus,
  type Logger,
  type ParsedPaper,
  type Source,
} from '@reelset/core'
import { EMBED_BATCH_SIZE, SOURCE_ONLY_EMBED_EXCERPT_CHARS } from '../config'
import { transitionClearingPriority } from '../generate/priority'
import type { RenderJobMessage } from '../env'
import { approxTokens, embeddingCostUsd, type Embedder } from './gemini'
import {
  parseModelOutput,
  truncateAtWord,
  type LlmClient,
  type LlmImage,
  type NarrationLimits,
  type StyleReport,
} from './output'
import {
  buildEvidenceRows,
  hasEnoughEvidence,
  parseExtraTexts,
  parseFacts,
  hasDemo,
  selectPromptChunks,
  stageFor,
  youtubeIdFromKey,
} from './decide'
import { captureRepoDemo, defaultDemoFetchers } from '../demo'
import { vetImages, type VetDeps } from './image-vet'
import { captureItemImages } from '../images'
import { pdfMarkdownEvidence } from '../arxiv-html'
import { arxivIdFromKey, type PaperClient } from '../paper-client'
import type { ScrapeFallback } from '../types'
import { buildSourceBrief, type BriefInput, type SourceBrief } from './brief'
import { enrichItem } from '../brief-fetch'
import { paperAssetsPrompt, resolvePaperShots } from './paper-shots'
import { primarySource } from '../score'
import { markDecisionNotApplied, runGate, type GateDeps, type GateResult } from './gate'
import { LLM_PROVIDER } from './llm'
import { STYLE_LIMITS, type StyleLimits } from './plain'
import {
  NARRATION_MAX_WORDS,
  NARRATION_MIN_WORDS,
  PROMPT_VERSION,
  SYSTEM_PROMPT,
  buildUserPrompt,
  itemImagesPrompt,
} from './prompt'
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
  llmModel: ClaudeModel
  narrationLimits?: NarrationLimits
  /** Plain-language and hook checks; false turns them off (tests with synthetic scripts). */
  styleLimits?: StyleLimits | false
  embeddingModel: string
  /** The reel-worthiness gate; absent means every item goes straight to its script. */
  gate?: GateDeps
  alertWebhookUrl?: string
  githubToken?: string
  /** Claude image vetting; absent in tests and when not configured. */
  vet?: Omit<VetDeps, 'log'>
  /** Downloads an item image so the script model can look at it; absent means text only. */
  promptImage?: (url: string) => Promise<LlmImage | null>
}

export type ProcessOutcome =
  | 'rendered_enqueued'
  | 'embedded'
  | 'insufficient_source'
  | 'source_only'
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
  priority_at?: Date | null
  owner_id?: string | null
  score?: number | null
  status_changed_at?: Date | null
  rendered_at?: Date | null
  images: unknown
  demo?: unknown
}

/** One extra call is allowed for a style rewrite; schema, length and safety failures still stop at two. */
const MAX_LLM_CALLS = 3
const MAX_HARD_REJECTIONS = 2
const MAX_PROMPT_IMAGES = 4
export const NARRATION_LIMITS = {
  min: NARRATION_MIN_WORDS,
  max: NARRATION_MAX_WORDS,
  maxSpokenChars: MAX_SPOKEN_CHARS,
}

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
      'priority_at',
      'owner_id',
      'score',
      'status_changed_at',
      'rendered_at',
      'images',
      'demo',
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
): Promise<{ images: ItemImage[]; demo: unknown }> {
  try {
    const captured = await captureItemImages(
      {
        canonicalKey: item.canonical_key,
        canonicalUrl: item.canonical_url,
        mentionUrls: mentions.map((m) => m.url),
        paper,
      },
      { log, githubToken: deps.githubToken },
    )
    const keepAll = isRedditPost(item.canonical_key)
    const images = deps.vet
      ? await vetImages(captured, { ...deps.vet, log }, { keepAll })
      : captured
    await deps.db
      .updateTable('item')
      .set({ images: JSON.stringify(images) })
      .where('id', '=', item.id)
      .where('images', 'is', null)
      .execute()
    return { images, demo: await storeDemo(deps, item, log) }
  } catch (err) {
    log.warn(errorFields(err), 'image capture failed, continuing without images')
    return { images: [], demo: item.demo }
  }
}

/** Captures a GitHub repo's demo once and returns the item's demo as it now stands. */
async function storeDemo(deps: ProcessDeps, item: ItemRow, log: Logger): Promise<unknown> {
  if (!item.canonical_key.startsWith('github:') || item.demo != null) return item.demo
  const [owner, repo] = item.canonical_key.slice('github:'.length).split('/')
  if (!owner || !repo) return item.demo
  const demo = await captureRepoDemo(owner, repo, defaultDemoFetchers(), log)
  await deps.db
    .updateTable('item')
    .set({ demo: JSON.stringify(demo ?? { none: true }) })
    .where('id', '=', item.id)
    .execute()
  return demo
}

function isRedditPost(canonicalKey: string): boolean {
  return canonicalKey.startsWith('reddit:')
}

/** What the vetting model read in each of a post's own images, as evidence the script can cite. */
export function postImageTexts(images: readonly ItemImage[]): string[] {
  return images
    .filter((img) => img.kind !== 'avatar' && (img.caption || img.text))
    .map((img, i) =>
      [
        `Image ${i + 1} in the post${img.caption ? `: ${img.caption}` : ''}.`,
        img.text ? `Text in the image: ${img.text}` : '',
      ]
        .filter(Boolean)
        .join(' '),
    )
}

/** Downloads the post's own pictures for the script model; a failed download is just skipped. */
async function loadPromptImages(
  deps: ProcessDeps,
  item: ItemRow,
  images: readonly ItemImage[],
  log: Logger,
): Promise<LlmImage[]> {
  if (!deps.promptImage || !isRedditPost(item.canonical_key)) return []
  const picked = images.filter((img) => img.kind !== 'avatar').slice(0, MAX_PROMPT_IMAGES)
  const loaded = await Promise.all(
    picked.map((img) =>
      deps.promptImage!(img.url).catch((err) => {
        log.warn({ url: img.url.slice(0, 80), ...errorFields(err) }, 'prompt image download failed')
        return null
      }),
    ),
  )
  const out = loaded.filter((img): img is LlmImage => img !== null)
  log.info({ wanted: picked.length, attached: out.length }, 'post images attached to the prompt')
  return out
}

function paperTexts(paper: ParsedPaper | null, source: string): string[] | null {
  if (!paper || source !== 'papers') return null
  const texts = paperEvidenceTexts(paper)
  return texts.length > 0 ? texts : null
}

function safeBrief(log: Logger, input: BriefInput): SourceBrief {
  try {
    return buildSourceBrief(input)
  } catch (err) {
    log.warn(errorFields(err), 'source brief failed, continuing without it')
    return { text: '', facts: '' }
  }
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
    .select([
      'id',
      'source',
      'external_id',
      'url',
      'title',
      'body',
      'raw',
      'author',
      'score',
      'num_comments',
      'published_at',
    ])
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
  const { images, demo } =
    item.images == null
      ? await storeImages(deps, item, mentions, log, paper)
      : { images: parseItemImages(item.images), demo: item.demo }

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
      await transitionClearingPriority(
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

  const enrichment = await enrichItem(
    item.canonical_key,
    mentions.map((m) => ({
      id: m.id,
      source: m.source,
      externalId: m.external_id,
      extraTexts: parseExtraTexts(m.raw),
      facts: parseFacts(m.raw),
    })),
    { log, githubToken: deps.githubToken, scrape: deps.scrape },
  )
  const postId = isRedditPost(item.canonical_key)
    ? item.canonical_key.slice('reddit:'.length)
    : null
  const imageTexts = postId ? postImageTexts(images) : []
  if (imageTexts.length > 0)
    log.info({ images: imageTexts.length }, 'post image text added as evidence')
  const rows = buildEvidenceRows(
    mentions.map((m) => ({
      id: m.id,
      source: m.source,
      title: m.title,
      body: m.body,
      extraTexts: [
        ...(m.source === 'reddit' && m.external_id === postId ? imageTexts : []),
        ...(paperTexts(paper, m.source) ??
          (m.source === 'papers' ? pdfTexts : null) ??
          parseExtraTexts(m.raw)),
        ...(enrichment.extraTexts.get(m.id) ?? []),
      ],
    })),
    transcript,
  )
  if (!hasEnoughEvidence(rows)) {
    log.warn({ chunks: rows.length }, 'not enough source text, marking insufficient_source')
    await transitionClearingPriority(
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
  const evidence = stored.map((c) => c.text)
  const gate = await judgeItem(
    deps,
    item,
    { mentions, images, demo, hasTranscript: transcript !== null, evidence },
    log,
  )
  if (gate.kind === 'decided' && gate.applied && gate.verdict === 'source_only') {
    const settled = await settleSourceOnly(
      deps,
      item,
      gate,
      evidence,
      deliveryAttempt,
      startedAt,
      log,
    )
    if (settled) return 'source_only'
    await markDecisionNotApplied(db, gate.decisionId, log).catch((err) =>
      log.warn(errorFields(err), 'could not mark the gate decision not applied'),
    )
  }

  const promptChunks = selectPromptChunks(stored)
  const chunkIds = new Set(stored.map((c) => c.id))
  const promptChunkIds = new Set(promptChunks.map((c) => c.id))
  const brief = safeBrief(log, {
    kind: item.kind,
    title: item.title,
    canonicalKey: item.canonical_key,
    canonicalUrl: item.canonical_url,
    mentions: mentions.map((m) => ({
      source: m.source,
      url: m.url,
      title: m.title,
      body: m.body,
      author: m.author,
      score: m.score,
      numComments: m.num_comments,
      publishedAt: m.published_at,
      facts: parseFacts(m.raw),
      extraTexts: parseExtraTexts(m.raw),
      externalId: m.external_id,
    })),
    paper,
    hasDemo: hasDemo(item.demo),
    supplements: enrichment.supplements,
  })
  const sourceText = [
    brief.facts,
    item.title,
    item.canonical_url,
    ...mentions.map((m) => `${m.url} ${m.title ?? ''}`),
    ...stored.map((c) => c.text),
  ].join('\n')
  const imageUrls = [
    ...allowedImageSet(
      mentions.map((m) => ({ source: m.source, externalId: m.external_id })),
      [...stored.map((c) => c.text), ...mentions.map((m) => m.body ?? '')],
      images.map((img) => img.url),
    ),
  ]
  const promptImages = await loadPromptImages(deps, item, images, log)

  log.info({ chunks: stored.length, promptChunks: promptChunks.length }, 'evidence ready')

  let rejection: string | undefined
  let previous: string | undefined
  let accepted: GeneratedContent | null = null
  let acceptedStyle: StyleReport | null = null
  let fallback: { value: GeneratedContent; style: StyleReport } | null = null
  let hardRejections = 0
  let calls = 0
  const styleLimits = deps.styleLimits === false ? undefined : (deps.styleLimits ?? STYLE_LIMITS)

  for (
    let attempt = 1;
    attempt <= MAX_LLM_CALLS && hardRejections < MAX_HARD_REJECTIONS && !accepted;
    attempt++
  ) {
    calls = attempt
    const llmStartedAt = performance.now()
    const result = await deps.llm.generate({
      system: SYSTEM_PROMPT,
      user: buildUserPrompt({
        title: item.title,
        kind: item.kind,
        canonicalUrl: item.canonical_url,
        chunks: promptChunks,
        imageUrls,
        itemImages: paper ? undefined : itemImagesPrompt(images, promptImages.length),
        paperAssets: paper ? paperAssetsPrompt(paper, images) : undefined,
        brief: brief.text || undefined,
        rejection,
        previous,
      }),
      images: promptImages,
    })
    await recordSpend(
      db,
      {
        category: 'llm',
        units: result.usage.inputTokens + result.usage.outputTokens,
        costUsd: claudeCostUsd(deps.llmModel, result.usage),
        meta: {
          model: deps.llmModel,
          provider: LLM_PROVIDER,
          images: promptImages.length,
          itemId: item.id,
          attempt,
        },
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

    const parsed = parseModelOutput(
      result.text,
      promptChunkIds,
      sourceText,
      deps.narrationLimits ?? NARRATION_LIMITS,
      styleLimits,
    )
    if (!parsed.ok) {
      rejection = parsed.reason
      previous = undefined
      hardRejections += 1
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
      previous = undefined
      hardRejections += 1
      log.warn({ attempt, reasons: verdict.reasons }, 'model output rejected (safety)')
      continue
    }
    const candidate = { value: parsed.value, style: parsed.style }
    if (!fallback || candidate.style.issues.length <= fallback.style.issues.length) {
      fallback = candidate
    }
    log.info(
      {
        attempt,
        hookFormula: parsed.style.hookFormula,
        storyShape: parsed.style.storyShape,
        hookScore: parsed.style.hookScore,
        hookSeconds: parsed.style.hookSeconds,
        readingGrade: parsed.style.readingGrade,
        styleIssues: parsed.style.issues.length,
      },
      'script style checked',
    )
    if (parsed.style.issues.length > 0 && attempt < MAX_LLM_CALLS) {
      rejection = `the facts and format are fine, but the script is not easy enough to follow. Keep the same facts and fix: ${parsed.style.issues.join('; ')}`
      const written = parsed.value.script
      previous = [
        `hook: ${written.hook}`,
        ...written.beats.map((b, i) => `beat ${i + 1}: ${b.text}`),
        `outro: ${written.outro}`,
      ].join('\n')
      log.warn({ attempt, issues: parsed.style.issues }, 'script sent back for a style rewrite')
      continue
    }
    accepted = fallback.value
    acceptedStyle = fallback.style
  }

  if (!accepted && fallback) {
    accepted = fallback.value
    acceptedStyle = fallback.style
  }
  if (accepted && acceptedStyle && acceptedStyle.issues.length > 0) {
    log.warn(
      { calls, issues: acceptedStyle.issues },
      'script accepted with style issues left after the last rewrite',
    )
  }

  if (!accepted) {
    await transitionClearingPriority(
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
    await transitionClearingPriority(
      trx,
      {
        itemId: item.id,
        from: 'found',
        to: 'summarized',
        attempt: deliveryAttempt,
        durationMs: Math.round(performance.now() - startedAt),
        meta: {
          promptVersion: PROMPT_VERSION,
          chunks: stored.length,
          llmCalls: calls,
          ...(acceptedStyle
            ? {
                hookFormula: acceptedStyle.hookFormula,
                hookScore: acceptedStyle.hookScore,
                readingGrade: acceptedStyle.readingGrade,
                styleIssues: acceptedStyle.issues.map((i) => i.slice(0, 160)),
              }
            : {}),
        },
      },
      log,
    )
  })
  return 'summarized'
}

type GateFacts = {
  mentions: readonly {
    source: Source
    score: number | null
    num_comments: number | null
    published_at: Date
  }[]
  images: readonly ItemImage[]
  demo: unknown
  hasTranscript: boolean
  evidence: readonly string[]
}

async function judgeItem(
  deps: ProcessDeps,
  item: ItemRow,
  facts: GateFacts,
  log: Logger,
): Promise<GateResult> {
  if (!deps.gate) return { kind: 'skipped', reason: 'off' }
  const signals = facts.mentions.map((m) => ({
    source: m.source,
    score: m.score,
    numComments: m.num_comments,
    publishedAt: new Date(m.published_at),
  }))
  const source = primarySource(signals, new Date()) ?? facts.mentions[0]!.source
  return runGate(
    { db: deps.db, log, gate: deps.gate },
    {
      itemId: item.id,
      title: item.title,
      kind: item.kind,
      source,
      itemScore: Math.min(1, Math.max(0, Number(item.score) || 0)),
      requested: isRequested(item),
      renderedBefore: item.rendered_at != null,
      inStatusSince: item.status_changed_at ? new Date(item.status_changed_at) : null,
      mentions: signals,
      usableImages: facts.images.filter((img) => img.kind !== 'avatar').length,
      hasDemo: hasDemo(facts.demo),
      hasTranscript: facts.hasTranscript,
      evidence: facts.evidence,
    },
  )
}

function isRequested(item: Pick<ItemRow, 'owner_id' | 'priority_at'>): boolean {
  return item.owner_id != null || item.priority_at != null
}

/** The gate said no reel: embed the item so Ask can cite it, then park it without a script. False when a user request arrived meanwhile, so the item must go on to its script. */
async function settleSourceOnly(
  deps: ProcessDeps,
  item: ItemRow,
  gate: Extract<GateResult, { kind: 'decided' }>,
  evidence: readonly string[],
  deliveryAttempt: number,
  startedAt: number,
  log: Logger,
): Promise<boolean> {
  const summary = item.tldr || truncateAtWord(evidence.join('\n'), SOURCE_ONLY_EMBED_EXCERPT_CHARS)
  const chunksEmbedded = await embedItem(deps, item.id, itemEmbeddingText(item, summary), log)
  const settled = await deps.db.transaction().execute(async (trx) => {
    // Locks the row a reel request writes its priority to, so a request cannot slip in before the transition.
    const current = await trx
      .selectFrom('item')
      .select(['owner_id', 'priority_at'])
      .where('id', '=', item.id)
      .forUpdate()
      .executeTakeFirst()
    if (current && isRequested(current)) return false
    await transitionClearingPriority(
      trx,
      {
        itemId: item.id,
        from: 'found',
        to: 'source_only',
        attempt: deliveryAttempt,
        durationMs: Math.round(performance.now() - startedAt),
        meta: {
          verdict: gate.verdict,
          score: gate.score,
          decisionId: gate.decisionId,
          decidedBy: gate.decidedBy,
          chunksEmbedded,
          model: deps.embeddingModel,
        },
      },
      log,
    )
    await trx.updateTable('item').set({ queued_at: null }).where('id', '=', item.id).execute()
    return true
  })
  if (!settled) {
    log.info(
      { decisionId: gate.decisionId },
      'a reel was requested while the gate judged the item, writing its script instead',
    )
    return false
  }
  log.info(
    { decisionId: gate.decisionId, score: gate.score, chunksEmbedded },
    'item kept as source only, no script written',
  )
  return true
}

function itemEmbeddingText(item: ItemRow, summary: string): string {
  return [item.title, summary, item.topics.join(', ')].join('\n')
}

/** Embeds the item's pending evidence chunks and the item itself; returns how many chunks were embedded. */
async function embedItem(
  deps: ProcessDeps,
  itemId: string,
  itemText: string,
  log: Logger,
): Promise<number> {
  const { db } = deps
  const pending = await sql<{ id: string; text: string }>`
    select id, text from evidence_chunk
    where item_id = ${itemId} and embedding is null
    order by mention_id, chunk_index`.execute(db)

  for (let start = 0; start < pending.rows.length; start += EMBED_BATCH_SIZE) {
    const batch = pending.rows.slice(start, start + EMBED_BATCH_SIZE)
    const vectors = await deps.embedder.embed(batch.map((c) => c.text))
    await recordEmbeddingSpend(
      deps,
      batch.map((c) => c.text),
      itemId,
      log,
    )
    const literals = vectors.map((v) => toVectorLiteral(v))
    await sql`
      update evidence_chunk c set embedding = v.e::vector
      from unnest(${batch.map((c) => c.id)}::uuid[], ${literals}::text[]) as v(id, e)
      where c.id = v.id`.execute(db)
  }

  const [itemVector] = await deps.embedder.embed([itemText])
  if (!itemVector) throw new Error('embedder returned no vector for item')
  await recordEmbeddingSpend(deps, [itemText], itemId, log)
  await setItemEmbedding(db, itemId, itemVector, log)
  return pending.rows.length
}

async function embedAndAdvance(
  deps: ProcessDeps,
  item: ItemRow,
  deliveryAttempt: number,
  log: Logger,
): Promise<ProcessOutcome> {
  const { db } = deps
  const startedAt = performance.now()
  const chunksEmbedded = await embedItem(
    deps,
    item.id,
    itemEmbeddingText(item, item.tldr ?? ''),
    log,
  )

  await db.transaction().execute(async (trx) => {
    await transitionClearingPriority(
      trx,
      {
        itemId: item.id,
        from: 'summarized',
        to: 'embedded',
        attempt: deliveryAttempt,
        durationMs: Math.round(performance.now() - startedAt),
        meta: { chunksEmbedded, model: deps.embeddingModel },
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
  await deps.renderQueue.send({
    itemId: item.id,
    attempt: 0,
    ...(item.priority_at ? { priority: true } : {}),
  })
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
    await transitionClearingPriority(
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
