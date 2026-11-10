import { createDb, createLogger, reelScriptSchema } from '@reelset/core'
import { sql } from 'kysely'
import { writeFileSync } from 'node:fs'
import { createRenderStore } from '../../workers/render/src/store'
import { pickBroll } from '../../workers/render/src/pexels'
import { speakableNumbers } from '../../workers/render/src/tts'
import { collectImageUrls, containerTitle, sourceImageUrls } from '../../workers/render/src/plan'

const [prefix, out] = process.argv.slice(2)
const log = createLogger({ app: 'local', level: 'error' })
const { db, close } = createDb({
  connectionString: (process.env.DIRECT_URL ?? process.env.DATABASE_URL)!,
  log,
  max: 1,
})
const mem = new Map<string, string>()
const cache = {
  async get(k: string) {
    const v = mem.get(k)
    return v === undefined ? null : ({ json: async () => JSON.parse(v) } as never)
  },
  async put(k: string, v: unknown) {
    mem.set(k, String(v))
    return null as never
  },
}
try {
  const row = await sql<{
    id: string
  }>`select id from item where id::text like ${prefix + '%'}`.execute(db)
  const item = (await createRenderStore(db, log).loadItem(row.rows[0]!.id))!
  const script = speakableNumbers(reelScriptSchema.parse(item.script))
  const broll = await pickBroll(
    { apiKey: process.env.PEXELS_API_KEY!, fetch: (u, i) => fetch(u, i), cache, log },
    script.beats,
    { source: item.source, title: item.title },
  )
  const payload = {
    jobId: `local-${prefix}`,
    script,
    title: containerTitle(item.title),
    sourceLabel: item.sourceLabel,
    imageUrls: collectImageUrls(script),
    voice: 'en-US-AriaNeural',
    ttsEngine: 'edge',
    source: item.source,
    canonicalUrl: item.canonicalUrl,
    sourceImageUrls: sourceImageUrls(item.source, [item.canonicalUrl, item.mentionUrl]),
    images: item.images,
    facts: item.facts,
    broll: broll.length ? broll : undefined,
    demo: item.demo,
  }
  writeFileSync(out!, JSON.stringify(payload))
  console.log(
    prefix,
    'broll',
    broll.map((b) => b.pageUrl.split('/video/')[1]),
  )
} finally {
  await close()
}
