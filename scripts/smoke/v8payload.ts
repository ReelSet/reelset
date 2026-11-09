import { readFileSync, writeFileSync } from 'node:fs'
import { createDb, createLogger, reelScriptSchema } from '@reelset/core'
import { sql } from 'kysely'
import { createRenderStore } from '../../workers/render/src/store'
import { collectImageUrls, sourceImageUrls } from '../../workers/render/src/plan'

// usage: tsx --env-file=.env.local scripts/smoke/v8payload.ts <v8dir> <name> <itemIdPrefix>
// Builds the exact /render body the consumer sends: loadItem (stored facts, images), generated script, Aura narration.
const [dir, name, prefix] = process.argv.slice(2)
const log = createLogger({ app: 'smoke', level: 'error' })
const { db, close } = createDb({ connectionString: process.env.DIRECT_URL!, log, max: 1 })
try {
  const id = (await sql<{ id: string }>`select id from item where id::text like ${prefix + '%'}`.execute(db)).rows[0]!.id
  const item = (await createRenderStore(db, log).loadItem(id))!
  const script = reelScriptSchema.parse(JSON.parse(readFileSync(`${dir}/gen/${name}.script.json`, 'utf8')))
  const words = JSON.parse(readFileSync(`${dir}/aura/${name}/words.json`, 'utf8'))
  const audioBase64 = readFileSync(`${dir}/aura/${name}/audio.mp3`).toString('base64')
  const body = {
    jobId: `v8-${name}`,
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
  }
  writeFileSync(`${dir}/${name}.payload.json`, JSON.stringify(body))
  console.log(name, item.sourceLabel, 'images', item.images.length, 'facts', JSON.stringify(item.facts).slice(0, 600))
} finally {
  await close()
}
