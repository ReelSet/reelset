import { readFileSync, writeFileSync } from 'node:fs'
import { createDb, createLogger, reelScriptSchema } from '@reelset/core'
import { sql } from 'kysely'
import { createRenderStore } from '../../workers/render/src/store'
import { collectImageUrls, sourceImageUrls } from '../../workers/render/src/plan'
import { parseDemo } from '../../workers/render/src/demo'
import { pickBroll } from '../../workers/render/src/pexels'
import { captureRepoDemo, defaultDemoFetchers } from '../../workers/ingest/src/demo'

// usage: tsx --env-file=.env.local scripts/smoke/v9payload.ts <dir> <name> <itemIdPrefix> <script.json> <auraDir> [--demo]
// Builds the /render body the consumer sends: stored facts and images, a stored script, Aura narration,
// Pexels b-roll picked with the real key (in-memory cache) and, with --demo, the README demo capture.
const [dir, name, prefix, scriptPath, auraDir] = process.argv.slice(2)
const withDemo = process.argv.includes('--demo')
const log = createLogger({ app: 'smoke', level: 'info' })
const { db, close } = createDb({ connectionString: process.env.DIRECT_URL!, log, max: 1 })
const mem = new Map<string, string>()
const cache = {
  get: async (k: string) =>
    mem.has(k)
      ? { text: async () => mem.get(k)!, json: async () => JSON.parse(mem.get(k)!) }
      : null,
  put: async (k: string, v: any) => void mem.set(k, typeof v === 'string' ? v : String(v)),
} as any
try {
  const row = (
    await sql<{
      id: string
      key: string
    }>`select id, canonical_key as key from item where id::text like ${prefix + '%'}`.execute(db)
  ).rows[0]!
  const item = (await createRenderStore(db, log).loadItem(row.id))!
  const script = reelScriptSchema.parse(JSON.parse(readFileSync(scriptPath!, 'utf8')))
  const words = JSON.parse(readFileSync(`${auraDir}/words.json`, 'utf8'))
  const audioBase64 = readFileSync(`${auraDir}/audio.mp3`).toString('base64')
  let demo = item.demo
  if (withDemo) {
    const [o, r] = row.key.slice('github:'.length).split('/')
    demo = parseDemo(await captureRepoDemo(o!, r!, defaultDemoFetchers(), log), item.canonicalUrl)
  }
  const broll = await pickBroll(
    { apiKey: process.env.PEXELS_API_KEY!, fetch: (u, i) => fetch(u, i), cache, log },
    script.beats,
    { source: item.source, title: item.title },
  )
  const body = {
    jobId: `v9-sample-${name}`,
    script,
    title: item.title,
    sourceLabel: item.sourceLabel,
    imageUrls: collectImageUrls(script),
    voice: 'aura2-hera',
    narration: { audioBase64, words },
    source: item.source ?? undefined,
    canonicalUrl: item.canonicalUrl,
    sourceImageUrls: sourceImageUrls(item.source, [item.canonicalUrl, item.mentionUrl]),
    images: item.images,
    facts: item.facts,
    broll: broll.length > 0 ? broll : undefined,
    demo,
  }
  writeFileSync(`${dir}/${name}.payload.json`, JSON.stringify(body))
  console.log(
    name,
    item.sourceLabel,
    'images',
    item.images.length,
    'broll',
    broll.map((b) => `${b.beat}:${b.id}`).join(','),
    'demo',
    JSON.stringify(demo),
  )
} finally {
  await close()
}
