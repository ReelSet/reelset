import { createDb, createLogger } from '@reelset/core'
import { sql } from 'kysely'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createLlm } from '../../workers/ingest/src/pipeline/llm'
import { parseModelOutput } from '../../workers/ingest/src/pipeline/output'
import { SYSTEM_PROMPT, buildUserPrompt } from '../../workers/ingest/src/pipeline/prompt'
import { selectPromptChunks } from '../../workers/ingest/src/pipeline/decide'
import { narrationWordCount } from '../../workers/ingest/src/pipeline/shots'
import { validateGenerated } from '../../workers/ingest/src/pipeline/safety'

// Generates v7 scripts (headline + shots) for the sample items through the real Gemini path.
// usage: tsx --env-file=.env.local scripts/smoke/v7Scripts.ts <outDir>
const out = process.argv[2]!
mkdirSync(out, { recursive: true })
const log = createLogger({ app: 'smoke', level: 'error' })
const { db, close } = createDb({ connectionString: process.env.DIRECT_URL!, log, max: 1 })
const { client: llm } = createLlm(process.env, log)
const items = { github: '5d68d1b2', youtube: 'f74b5ddf', papers: 'ccd1893c' }
try {
  for (const [name, prefix] of Object.entries(items)) {
    const item = (
      await sql<any>`select id, title, kind, canonical_url from item where id::text like ${prefix + '%'}`.execute(
        db,
      )
    ).rows[0]
    const chunks = (
      await sql<any>`select id, text from evidence_chunk where item_id = ${item.id} order by mention_id, chunk_index`.execute(
        db,
      )
    ).rows as { id: string; text: string }[]
    const promptChunks = selectPromptChunks(chunks)
    const allowed = new Set(promptChunks.map((c) => c.id))
    const sourceText = [item.title, item.canonical_url, ...chunks.map((c) => c.text)].join('\n')
    let rejection: string | undefined
    for (let attempt = 1; attempt <= 3; attempt++) {
      const res = await llm.generate({
        system: SYSTEM_PROMPT,
        user: buildUserPrompt({
          title: item.title,
          kind: item.kind,
          canonicalUrl: item.canonical_url,
          chunks: promptChunks,
          imageUrls: [],
          rejection,
        }),
      })
      const parsed = parseModelOutput(res.text, allowed, sourceText)
      if (!parsed.ok) {
        rejection = parsed.reason
        console.log(name, attempt, 'rejected', rejection)
        continue
      }
      const verdict = validateGenerated({
        ...parsed.value,
        sourceText,
        chunkIds: new Set(chunks.map((c) => c.id)),
        allowedImageUrls: new Set(),
      })
      if (!verdict.ok) {
        rejection = verdict.reasons.join('; ')
        console.log(name, attempt, 'unsafe', rejection)
        continue
      }
      writeFileSync(`${out}/${name}.json`, JSON.stringify(parsed.value.script, null, 2))
      const shots = parsed.value.script.beats.reduce((n, b) => n + (b.shots?.length ?? 0), 0)
      console.log(
        name,
        'ok',
        'words',
        narrationWordCount(parsed.value.script),
        'shots',
        shots,
        parsed.value.script.headline,
      )
      break
    }
  }
} finally {
  await close()
}
