import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createDb, createLogger, paperEvidenceTexts, parsedPaperSchema, parseItemImages } from '@reelset/core'
import { sql } from 'kysely'
import { createLlm, loadLlmModels } from '../../workers/ingest/src/pipeline/llm'
import { parseModelOutput } from '../../workers/ingest/src/pipeline/output'
import { SYSTEM_PROMPT, buildUserPrompt } from '../../workers/ingest/src/pipeline/prompt'
import { buildEvidenceRows, selectPromptChunks } from '../../workers/ingest/src/pipeline/decide'
import { narrationWordCount } from '../../workers/ingest/src/pipeline/shots'
import { allowedImageSet, validateGenerated } from '../../workers/ingest/src/pipeline/safety'
import { paperAssetsPrompt, resolvePaperShots } from '../../workers/ingest/src/pipeline/paper-shots'
import { narrationText } from '../../workers/render/src/tts'

// usage: tsx --env-file=.env.local scripts/smoke/v8gen.ts <outDir> <name>=<itemIdPrefix>[:<arxivId>] ...
// Generates a new-prompt script with fresh paper evidence; read-only on the DB.
const [out, ...specs] = process.argv.slice(2)
mkdirSync(out!, { recursive: true })
const log = createLogger({ app: 'smoke', level: 'error' })
const { db, close } = createDb({ connectionString: process.env.DIRECT_URL!, log, max: 1 })
const models = await loadLlmModels(db, log)
const { client: llm } = createLlm(
  { apiKey: process.env.CLAUDE_API_KEY, model: models.scriptModel, effort: models.scriptEffort },
  log,
)
try {
  for (const spec of specs) {
    const [name, rest] = spec.split('=')
    const [prefix, arxivId] = rest!.split(':')
    const item = (
      await sql<any>`select id, title, kind, canonical_url, images from item where id::text like ${prefix + '%'}`.execute(db)
    ).rows[0]
    const images = parseItemImages(item.images)
    const mentions = (
      await sql<any>`select id, source, external_id, url, title, body, raw from mention where item_id = ${item.id} order by published_at asc`.execute(db)
    ).rows
    let paper = null
    if (arxivId) {
      const res = await fetch(`https://media.reelset.app/papers/${arxivId}/paper.json`)
      paper = parsedPaperSchema.parse(await res.json())
    }
    let chunks: { id: string; text: string }[]
    if (paper) {
      chunks = buildEvidenceRows(
        mentions.map((m: any) => ({ id: m.id, source: m.source, title: m.title, body: m.body, extraTexts: paperEvidenceTexts(paper) })),
        null,
      ).map((r) => ({ id: randomUUID(), text: r.text }))
    } else {
      chunks = (await sql<any>`select id, text from evidence_chunk where item_id = ${item.id} order by mention_id, chunk_index`.execute(db)).rows
    }
    const promptChunks = selectPromptChunks(chunks)
    const promptIds = new Set(promptChunks.map((c) => c.id))
    const sourceText = [item.title, item.canonical_url, ...mentions.map((m: any) => `${m.url} ${m.title ?? ''}`), ...chunks.map((c) => c.text)].join('\n')
    const imageUrls = [
      ...allowedImageSet(
        mentions.map((m: any) => ({ source: m.source, externalId: m.external_id })),
        [...chunks.map((c) => c.text), ...mentions.map((m: any) => m.body ?? '')],
      ),
    ]
    let rejection: string | undefined
    for (let attempt = 1; attempt <= 4; attempt++) {
      const res = await llm.generate({
        system: SYSTEM_PROMPT,
        user: buildUserPrompt({
          title: item.title, kind: item.kind, canonicalUrl: item.canonical_url,
          chunks: promptChunks, imageUrls,
          paperAssets: paper ? paperAssetsPrompt(paper, images) : undefined,
          rejection,
        }),
      })
      const parsed = parseModelOutput(res.text, promptIds, sourceText)
      if (!parsed.ok) { rejection = parsed.reason; console.log(name, attempt, 'rejected', rejection.slice(0, 200)); continue }
      const verdict = validateGenerated({ ...parsed.value, sourceText, chunkIds: new Set(chunks.map((c) => c.id)), allowedImageUrls: new Set(imageUrls) })
      if (!verdict.ok) { rejection = verdict.reasons.join('; '); console.log(name, attempt, 'unsafe', rejection.slice(0, 200)); continue }
      const stats = resolvePaperShots(parsed.value.script as any, paper, images)
      const script = parsed.value.script
      writeFileSync(`${out}/${name}.script.json`, JSON.stringify(script, null, 2))
      writeFileSync(`${out}/${name}.txt`, narrationText(script as any))
      console.log(name, 'ok words', narrationWordCount(script), JSON.stringify(stats), script.headline)
      console.log(JSON.stringify(script.beats.map((b: any) => [b.visual?.type, (b.shots ?? []).map((s: any) => s.type ?? s.screen ?? Object.keys(s).join('/'))])))
      break
    }
  }
} finally {
  await close()
}
