import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { sql } from 'kysely'
import {
  SETTINGS,
  createDb,
  createLogger,
  getSetting,
  loadDirectorConfig,
  reelScriptSchema,
} from '@reelset/core'
import { createBoxFetcher, parseBoxUrls } from '../../workers/render/src/box-fetcher'
import { DEFAULT_VOICE } from '../../workers/render/src/constants'
import {
  createContainerClient,
  type RenderInput,
  type RenderMetadata,
} from '../../workers/render/src/container-client'
import { RenderJobError } from '../../workers/render/src/errors'
import { pickBroll } from '../../workers/render/src/pexels'
import { collectImageUrls, containerTitle, sourceImageUrls } from '../../workers/render/src/plan'
import { createRenderStore } from '../../workers/render/src/store'
import { generateChatterbox } from '../../workers/render/src/chatterbox'
import {
  audioToBase64,
  fallbackEngineFor,
  speakableNumbers,
  wordsToJson,
} from '../../workers/render/src/tts'

// Usage: preview-render.ts <itemIdPrefix> <script.json> <outDir> [--boxes url1,url2] [--payload-only]
// --payload-only writes <outDir>/<id>-payload.json for workers/render/container/tools/render_local.py
// (render on this machine) and contacts no box.
// Renders a candidate script for an existing item on the production render boxes, with the same
// payload the render worker builds (facts, b-roll, demo, director, voice), and saves the MP4 and
// poster locally. Reads the database, writes nothing to it or to R2, and removes the job from the
// box afterwards. <script.json> is a reel script, or a regen-scripts --out file (uses .content.script).
// Voices: kokoro and edge run in the container; chatterbox is fetched from Modal like production
// (needs CHATTERBOX_TOKEN). Aura narration is synthesized inside the worker and is not reproduced.
const args = process.argv.slice(2)
const boxesAt = args.indexOf('--boxes')
const boxesArg = boxesAt >= 0 ? args.splice(boxesAt, 2)[1] : undefined
const payloadOnly = args.includes('--payload-only')
if (payloadOnly) args.splice(args.indexOf('--payload-only'), 1)
const [prefix, scriptPath, outDir] = args
if (!prefix || !scriptPath || !outDir) {
  throw new Error('usage: preview-render.ts <itemIdPrefix> <script.json> <outDir> [--boxes urls]')
}
const boxUrls = parseBoxUrls(
  boxesArg ?? process.env.BOX_URLS ?? 'https://box1.reelset.app,https://box2.reelset.app',
)
const token = process.env.RENDER_BOX_TOKEN ?? ''
if (!token && !payloadOnly) throw new Error('RENDER_BOX_TOKEN must be set')

const BUSY_ATTEMPTS = 60
const BUSY_WAIT_SECONDS = 15

const log = createLogger({ app: 'preview-render', level: 'info' })
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
  const rows = await sql<{ id: string }>`
    select id from item where id::text like ${prefix + '%'}`.execute(db)
  if (rows.rows.length !== 1) throw new Error(`${rows.rows.length} items match ${prefix}`)
  const item = (await createRenderStore(db, log).loadItem(rows.rows[0]!.id))!
  const file: unknown = JSON.parse(readFileSync(scriptPath, 'utf8'))
  const candidate = (file as { content?: { script?: unknown } }).content?.script ?? file
  const script = speakableNumbers(reelScriptSchema.parse(candidate))

  const provider = await getSetting(db, SETTINGS.ttsProvider, log)
  if (provider === 'aura2') throw new Error('tts_provider is aura2; this preview cannot match it')
  const ttsEngine = fallbackEngineFor(provider)
  const chatterboxUrl =
    process.env.CHATTERBOX_URL ??
    /"CHATTERBOX_URL":\s*"([^"]+)"/.exec(
      readFileSync(new URL('../../workers/render/wrangler.jsonc', import.meta.url), 'utf8'),
    )?.[1]
  const chatterboxToken = process.env.CHATTERBOX_TOKEN
  if (provider === 'chatterbox' && (!chatterboxUrl || !chatterboxToken))
    log.warn('tts_provider is chatterbox but CHATTERBOX_TOKEN or URL is missing; using kokoro')
  const narration =
    provider === 'chatterbox' && chatterboxUrl && chatterboxToken
      ? await generateChatterbox(
          { url: chatterboxUrl, token: chatterboxToken, fetch: (u, i) => fetch(u, i) },
          script,
          log,
        )
      : null
  const director = await loadDirectorConfig(db, log).catch(() => null)
  const broll = process.env.PEXELS_API_KEY
    ? await pickBroll(
        { apiKey: process.env.PEXELS_API_KEY, fetch: (u, i) => fetch(u, i), cache, log },
        script.beats,
        { source: item.source, title: item.title },
      ).catch(() => [])
    : []

  const jobId = `preview${Date.now().toString(36)}${item.id.replace(/-/g, '').slice(0, 12)}`
  const rlog = log.child({ itemId: item.id, jobId })
  rlog.info(
    { ttsEngine, director: !!director, broll: broll.length, boxes: boxUrls.length },
    'preview render starting',
  )
  const client = createContainerClient(createBoxFetcher({ baseUrls: boxUrls, token, log }), log)
  const startedAt = performance.now()
  const input: RenderInput = {
    jobId,
    script,
    title: containerTitle(item.title),
    sourceLabel: item.sourceLabel,
    imageUrls: collectImageUrls(script),
    voice: process.env.TTS_VOICE ?? DEFAULT_VOICE,
    ttsEngine: narration ? undefined : ttsEngine,
    narration: narration
      ? { audioBase64: audioToBase64(narration.audio), words: wordsToJson(narration.words) }
      : undefined,
    source: item.source,
    canonicalUrl: item.canonicalUrl,
    sourceImageUrls: sourceImageUrls(item.source, [item.canonicalUrl, item.mentionUrl]),
    images: item.images,
    facts: item.facts,
    sources: item.sources,
    broll: broll.length > 0 ? broll : undefined,
    demo: item.demo,
    director: director ?? undefined,
  }
  if (payloadOnly) {
    mkdirSync(outDir, { recursive: true })
    const payloadPath = join(outDir, `${item.id.slice(0, 8)}-payload.json`)
    writeFileSync(payloadPath, JSON.stringify(input))
    rlog.info({ payloadPath }, 'payload written, nothing sent to a box')
    process.exit(0)
  }
  let metadata: RenderMetadata | null = null
  for (let attempt = 1; !metadata; attempt++) {
    try {
      metadata = await client.render(input)
    } catch (err) {
      const busy =
        err instanceof RenderJobError && (err.code === 'busy' || err.code === 'in_progress')
      if (!busy || attempt >= BUSY_ATTEMPTS) throw err
      rlog.info({ attempt, waitSeconds: BUSY_WAIT_SECONDS }, 'boxes busy, waiting')
      await new Promise((resolve) => setTimeout(resolve, BUSY_WAIT_SECONDS * 1000))
    }
  }
  try {
    mkdirSync(outDir, { recursive: true })
    const base = join(outDir, `${item.id.slice(0, 8)}-preview`)
    writeFileSync(`${base}.mp4`, Buffer.from(await client.download(jobId, 'video')))
    writeFileSync(`${base}.jpg`, Buffer.from(await client.download(jobId, 'poster')))
    rlog.info(
      {
        video: `${base}.mp4`,
        durationMs: metadata.durationMs,
        bytes: metadata.bytes,
        ttsProvider: metadata.ttsProvider,
        box: metadata.box,
        templateVersion: metadata.templateVersion,
        wallMs: Math.round(performance.now() - startedAt),
      },
      'preview render saved',
    )
  } finally {
    await client.remove(jobId).catch(() => undefined)
  }
} finally {
  await close()
}
