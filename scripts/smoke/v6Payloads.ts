import { createDb, createLogger, parseItemImages } from '@reelset/core'
import { sql } from 'kysely'
import { writeFileSync } from 'node:fs'
import { collectImageUrls, sourceImageUrls, sourceLabel } from '../../workers/render/src/plan'

// Writes one render payload per source from real rendered items that have captured images.
const log = createLogger({ app: 'smoke', level: 'error' })
const { db, close } = createDb({ connectionString: process.env.DIRECT_URL!, log, max: 1 })
const out = 'scripts/smoke/out/v6/payloads'
const wanted: Record<string, string> = {
  github: "canonical_key like 'github:%'",
  youtube: "canonical_key like 'youtube:%'",
  papers: "canonical_key like 'arxiv:%'",
  news: "canonical_key like 'http%'",
}
try {
  for (const [name, cond] of Object.entries(wanted)) {
    const r = await sql<any>`select id, title, script, canonical_url, canonical_key, images from item
      where status = 'rendered' and script is not null and images is not null and ${sql.raw(cond)}
      order by jsonb_array_length(images) desc, published_at desc limit 1`.execute(db)
    const item = r.rows[0]
    if (!item) {
      console.log(name, 'no item')
      continue
    }
    const m = await sql<any>`select source, url from mention where item_id = ${item.id} order by score desc nulls last limit 1`.execute(db)
    const source = m.rows[0]?.source ?? 'news'
    const images = parseItemImages(item.images)
    const payload = {
      jobId: `v6-${name}-${item.id.slice(0, 8)}`,
      script: item.script,
      title: item.title,
      sourceLabel: sourceLabel(source),
      imageUrls: collectImageUrls(item.script),
      voice: 'en-US-AriaNeural',
      source,
      canonicalUrl: item.canonical_url,
      sourceImageUrls: sourceImageUrls(source, [item.canonical_url, m.rows[0]?.url]),
      images,
    }
    writeFileSync(`${out}/${name}.json`, JSON.stringify(payload))
    console.log(name, item.canonical_key.slice(0, 50), images.map((i) => i.kind).join(','))
  }
} finally {
  await close()
}
