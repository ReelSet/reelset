import { mkdirSync, writeFileSync } from 'node:fs'
import { createDb, createLogger, reelScriptSchema, type Source } from '@reelset/core'
import { sql } from 'kysely'
import { DEFAULT_VOICE } from '../../workers/render/src/constants'
import { collectImageUrls, sourceImageUrls, sourceLabel } from '../../workers/render/src/plan'

// Builds the exact /render payload the worker sends, for items of each source that have a script.
const outDir = new URL('./out/payloads/', import.meta.url).pathname
mkdirSync(outDir, { recursive: true })
const log = createLogger({ app: 'smoke', level: 'warn' })
const { db, close } = createDb({ connectionString: process.env.DIRECT_URL!, log, max: 1 })
try {
  const rows = await sql<{
    id: string
    title: string
    script: unknown
    canonical_url: string
    source: Source
    url: string
  }>`select distinct on (m.source) i.id, i.title, i.script, i.canonical_url, m.source, m.url
     from item i join mention m on m.item_id = i.id
     where i.script is not null and i.status in ('rendered','embedded','voiced')
     order by m.source, i.score desc`.execute(db)
  for (const row of rows.rows) {
    const script = reelScriptSchema.parse(row.script)
    const payload = {
      jobId: `smoke_${row.source}_${row.id.slice(0, 8)}`,
      script,
      title: row.title,
      sourceLabel: sourceLabel(row.source),
      imageUrls: collectImageUrls(script),
      voice: DEFAULT_VOICE,
      source: row.source,
      canonicalUrl: row.canonical_url,
      sourceImageUrls: sourceImageUrls(row.source, [row.canonical_url, row.url]),
    }
    writeFileSync(`${outDir}${row.source}.json`, JSON.stringify(payload, null, 2))
    console.log(
      row.source,
      row.id,
      row.title.slice(0, 60),
      script.beats.map((b) => b.visual.type).join(','),
    )
  }
} finally {
  await close()
}
