import { sql } from 'kysely'
import { contentHash, createDb, createLogger, recordSpend } from '@reelset/core'
import {
  createLlmClient,
  llmCostUsd,
  parseModelOutput,
} from '../../workers/ingest/src/pipeline/gemini'
import { selectPromptChunks } from '../../workers/ingest/src/pipeline/decide'
import {
  PROMPT_VERSION,
  SYSTEM_PROMPT,
  buildUserPrompt,
} from '../../workers/ingest/src/pipeline/prompt'
import { allowedImageSet, validateGenerated } from '../../workers/ingest/src/pipeline/safety'
import { narrationWordCount } from '../../workers/ingest/src/pipeline/shots'

// Usage: regen-scripts.ts [--apply] [--limit N] [--concurrency N] [--ids id1,id2]
// Regenerates reel scripts (headline + shots) with the current PROMPT_VERSION for items in the feed.
// Status is untouched, so the old reel stays live; the render cron re-renders on the new content hash.
// Dry run unless --apply (still calls Gemini, writes nothing).
const arg = (name: string) => {
  const i = process.argv.indexOf(name)
  return i > 0 ? process.argv[i + 1] : undefined
}
const apply = process.argv.includes('--apply')
const limit = Number(arg('--limit') ?? 100)
const concurrency = Number(arg('--concurrency') ?? 3)
const onlyIds = arg('--ids')?.split(',').filter(Boolean)
const ATTEMPTS = 3

const log = createLogger({ app: 'regen-scripts', level: 'warn' })
const { db, close } = createDb({ connectionString: process.env.DIRECT_URL!, log, max: 2 })
const model = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash'
const llm = createLlmClient(process.env.GEMINI_API_KEY!, model, log)

type Row = { id: string; title: string; kind: string; canonical_url: string }

async function regen(item: Row): Promise<'ok' | 'failed'> {
  const chunks = (
    await sql<{ id: string; text: string }>`
      select id, text from evidence_chunk where item_id = ${item.id} order by mention_id, chunk_index`.execute(
      db,
    )
  ).rows
  if (chunks.length === 0) return 'failed'
  const mentions = (
    await sql<{
      source: string
      external_id: string
      url: string
      title: string | null
      body: string | null
    }>`
      select source, external_id, url, title, body from mention where item_id = ${item.id}`.execute(
      db,
    )
  ).rows
  const promptChunks = selectPromptChunks(chunks)
  const promptIds = new Set(promptChunks.map((c) => c.id))
  const sourceText = [
    item.title,
    item.canonical_url,
    ...mentions.map((m) => `${m.url} ${m.title ?? ''}`),
    ...chunks.map((c) => c.text),
  ].join('\n')
  const imageUrls = [
    ...allowedImageSet(
      mentions.map((m) => ({ source: m.source as never, externalId: m.external_id })),
      [...chunks.map((c) => c.text), ...mentions.map((m) => m.body ?? '')],
    ),
  ]

  let rejection: string | undefined
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const res = await llm.generate({
      system: SYSTEM_PROMPT,
      user: buildUserPrompt({
        title: item.title,
        kind: item.kind,
        canonicalUrl: item.canonical_url,
        chunks: promptChunks,
        imageUrls,
        rejection,
      }),
    })
    if (apply) {
      await recordSpend(
        db,
        {
          category: 'llm',
          units: res.usage.inputTokens + res.usage.outputTokens,
          costUsd: llmCostUsd(res.usage),
          meta: { model, itemId: item.id, attempt, kind: 'regen-script' },
        },
        log,
      )
    }
    const parsed = parseModelOutput(res.text, promptIds, sourceText)
    if (!parsed.ok) {
      rejection = parsed.reason
      continue
    }
    const verdict = validateGenerated({
      ...parsed.value,
      sourceText,
      chunkIds: new Set(chunks.map((c) => c.id)),
      allowedImageUrls: new Set(imageUrls),
    })
    if (!verdict.ok) {
      rejection = verdict.reasons.join('; ')
      continue
    }
    const hash = await contentHash([
      item.title,
      parsed.value.tldr,
      JSON.stringify(parsed.value.script),
    ])
    console.log(
      item.id.slice(0, 8),
      'ok',
      `words=${narrationWordCount(parsed.value.script)}`,
      parsed.value.script.headline,
    )
    if (apply) {
      await db
        .updateTable('item')
        .set({
          tldr: parsed.value.tldr,
          script: JSON.stringify(parsed.value.script),
          topics: parsed.value.topics,
          content_hash: hash,
          prompt_version: PROMPT_VERSION,
        })
        .where('id', '=', item.id)
        .execute()
    }
    return 'ok'
  }
  console.log(item.id.slice(0, 8), 'FAILED', rejection?.slice(0, 160))
  return 'failed'
}

try {
  const items = (
    await sql<Row>`
      select i.id, i.title, i.kind, i.canonical_url from item i
      where i.status = 'rendered'
        and i.prompt_version is distinct from ${PROMPT_VERSION}
        and exists (select 1 from render r where r.item_id = i.id and r.status = 'done' and r.video_key is not null)
        ${onlyIds?.length ? sql`and i.id::text = any(${onlyIds})` : sql``}
      order by i.score desc
      limit ${limit}`.execute(db)
  ).rows
  console.log(`items to regenerate: ${items.length} (apply=${apply}, prompt=${PROMPT_VERSION})`)

  const tally = { ok: 0, failed: 0 }
  let next = 0
  const worker = async () => {
    while (next < items.length) tally[await regen(items[next++]!)]++
  }
  await Promise.all(Array.from({ length: concurrency }, worker))
  console.log(tally)
} finally {
  await close()
}
