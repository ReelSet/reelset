import { spawn, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { sql } from 'kysely'
import {
  CHATTERBOX_VOICES,
  CLAUDE_EFFORTS,
  CLAUDE_MODELS,
  DIRECTOR_EFFORTS,
  DIRECTOR_MAX_MAX_TOKENS,
  DIRECTOR_MIN_MAX_TOKENS,
  SETTINGS,
  claudeCostUsd,
  createDb,
  createLogger,
  getSetting,
  listSkills,
  reelScriptSchema,
  selectSkills,
  type ClaudeEffort,
  type ClaudeModel,
  type Database,
  type DirectorEffort,
  type DirectorPayload,
  type ReelScript,
} from '@reelset/core'
import { parseModelOutput, type StyleReport } from '../../workers/ingest/src/pipeline/output'
import { STYLE_LIMITS } from '../../workers/ingest/src/pipeline/plain'
import { createLlm } from '../../workers/ingest/src/pipeline/llm'
import { buildSourceBrief } from '../../workers/ingest/src/pipeline/brief'
import {
  parseExtraTexts,
  parseFacts,
  selectPromptChunks,
} from '../../workers/ingest/src/pipeline/decide'
import {
  QWEN_SYSTEM_PROMPT,
  SYSTEM_PROMPT,
  buildUserPrompt,
} from '../../workers/ingest/src/pipeline/prompt'
import {
  allowedImageSet,
  validateGenerated,
  type GeneratedContent,
} from '../../workers/ingest/src/pipeline/safety'
import { narrationWordCount } from '../../workers/ingest/src/pipeline/shots'
import { createBoxFetcher, parseBoxUrls } from '../../workers/render/src/box-fetcher'
import { chatterboxSegments } from '../../workers/render/src/chatterbox'
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
import {
  MAX_NARRATION_SECONDS,
  audioToBase64,
  speakableNumbers,
  wordsToJson,
} from '../../workers/render/src/tts'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../..')
const TTS_DIR = join(REPO, 'workers/tts-modal')
const TTS_TIMEOUT_MS = 15 * 60 * 1000
const TTS_TRIES = 3
const SERVE_READY_MS = 5 * 60 * 1000
const RENDER_DIR = join(REPO, 'workers/render/container')
const DEFAULT_BOXES = 'https://box1.reelset.app,https://box2.reelset.app'
const BOX_BUSY_TRIES = 60
const BOX_BUSY_WAIT_MS = 15_000

const HELP = `reel-lab: try script prompts, models, voice and video settings on one item.
Nothing is written to the database or R2 and nothing is deployed.

Usage: npm run reel-lab -- <command> [options]

Commands
  script            write a script only
  both              write a script, then voice it to a WAV
  video             write a script, voice it, then render the MP4
  voice             voice an existing script (--script <file.script.json>)
  render            render an MP4 from an existing script (--script); reuses its WAV if there
  items             list recent items with their id prefix
  prompt            print the full system prompt that would be sent

Options (defaults come from scripts/reel-lab/config.json; flags win)
  --config <file>        another config file
  --item <id prefix>     item to write about
  --prompt <file|none>   extra rules layered on top of the base prompt
  --base qwen|standard   base system prompt (qwen adds the Qwen voice rules)
  --model <id>           ${CLAUDE_MODELS.join(' | ')}
  --effort <level>       ${CLAUDE_EFFORTS.join(' | ')} (default: the app setting)
  --attempts <n>         most LLM calls for one script
  --first-valid          keep the first valid script (--no-first-valid retries on style issues)
  --min-words <n>  --max-words <n>  --max-chars <n>   narration length limits
  --voice <name>         ${CHATTERBOX_VOICES.join(' | ')}
  --segments <n|paragraphs>  takes the audio is made in (paragraphs = one per hook/beat/outro)
  --natural              keep the voice's own pauses (--no-natural lets the code shape them)
  --pause <s>            silence between paragraphs, word to word (default 0.45)
  --edge-pause <s>       silence after the hook and before the outro (default: same as --pause)
  --trim words|level|off how each take's edges are trimmed before padding: at the first/last
                         word, where the audio drops below --trim-db, or not at all
  --trim-db <dB>         loudness that counts as silence for --trim level (default -45)
  --lead-keep <s>  --tail-keep <s>  audio kept before the first / after the last word (0.06 / 0.12)
  --fade-in-ms <ms>  --fade-out-ms <ms>  fades at each take's edges (default 8 / 8)
  --tail-buffer <text>   runway the voice reads after each take's last word, then cut off, so
                         the final word isn't clipped: a word ("okay.") or punctuation (",")
  (stitch options need the dev voice server; --segments N groups paragraphs into N takes)
  --tts serve|dev|prod   serve starts \`modal serve\` for you; dev uses one already running
  --out <dir>  --tag <name>  where files go and what they are called
  --script <file>        script file for the voice and render commands
  --revoice              render: make new audio even if the script already has some

Video (the director is the Claude model that plans and draws each scene)
  --director             use the director (--no-director: the plain template renderer)
  --director-model <id>  ${CLAUDE_MODELS.join(' | ')}
  --director-effort <level>  ${DIRECTOR_EFFORTS.join(' | ')}
  --director-review      let it check and fix its own scenes (--no-director-review skips)
  --director-max-tokens <n>  ${DIRECTOR_MIN_MAX_TOKENS} to ${DIRECTOR_MAX_MAX_TOKENS}
  --director-rules <file>    replace the director's rules with this file
  (director settings left as null in the config use the app settings)
  --render local|box     local renders on this Mac; box uses the prod render boxes (no upload)
  --broll                add Pexels stock clips (--no-broll leaves them out)
  --env <file>           env file (default: .env.local at the repo root)

Env: DIRECT_URL or DATABASE_URL, CLAUDE_API_KEY, CHATTERBOX_TOKEN, QWEN_DEV_URL (the
\`modal serve\` URL of reelset-qwen-tts; prod is the same URL without "-dev"),
PEXELS_API_KEY for b-roll, RENDER_BOX_TOKEN for --render box.`

type Config = {
  item?: string
  prompt: string
  base: 'qwen' | 'standard'
  model: ClaudeModel | null
  effort: ClaudeEffort | null
  attempts: number
  firstValid: boolean
  minWords: number
  maxWords: number
  maxChars: number
  voice: string
  segments: number | 'paragraphs'
  natural: boolean
  stitch: Stitch
  tts: 'serve' | 'dev' | 'prod'
  out: string
  tag?: string
  script?: string
  director: boolean | null
  directorModel: ClaudeModel | null
  directorEffort: DirectorEffort | null
  directorReview: boolean | null
  directorMaxTokens: number | null
  directorRules: string | null
  render: 'local' | 'box'
  broll: boolean
}

type Stitch = {
  pause: number | null
  edgePause: number | null
  trim: 'words' | 'level' | 'off' | null
  trimDb: number | null
  leadKeep: number | null
  tailKeep: number | null
  fadeInMs: number | null
  fadeOutMs: number | null
  tailBuffer: string | null
}

const STITCH_NUMBERS = {
  pause: ['pause', 0, 2],
  edgePause: ['edge-pause', 0, 2],
  trimDb: ['trim-db', -80, -20],
  leadKeep: ['lead-keep', 0, 0.5],
  tailKeep: ['tail-keep', 0, 0.5],
  fadeInMs: ['fade-in-ms', 0, 100],
  fadeOutMs: ['fade-out-ms', 0, 100],
} as const

type Narration = { audio: Uint8Array; words: TimedWord[] }

type ScriptResult = {
  content: GeneratedContent
  style: StyleReport
  model: ClaudeModel
  effort: ClaudeEffort
  calls: number
  costUsd: number
}

type TimedWord = { text: string; start: number; end: number }

const { values: flags, positionals } = parseArgs({
  allowPositionals: true,
  allowNegative: true,
  options: {
    help: { type: 'boolean', short: 'h' },
    config: { type: 'string' },
    env: { type: 'string' },
    item: { type: 'string' },
    prompt: { type: 'string' },
    base: { type: 'string' },
    model: { type: 'string' },
    effort: { type: 'string' },
    attempts: { type: 'string' },
    'first-valid': { type: 'boolean' },
    'min-words': { type: 'string' },
    'max-words': { type: 'string' },
    'max-chars': { type: 'string' },
    voice: { type: 'string' },
    segments: { type: 'string' },
    natural: { type: 'boolean' },
    pause: { type: 'string' },
    'edge-pause': { type: 'string' },
    trim: { type: 'string' },
    'trim-db': { type: 'string' },
    'lead-keep': { type: 'string' },
    'tail-keep': { type: 'string' },
    'fade-in-ms': { type: 'string' },
    'fade-out-ms': { type: 'string' },
    'tail-buffer': { type: 'string' },
    tts: { type: 'string' },
    out: { type: 'string' },
    tag: { type: 'string' },
    script: { type: 'string' },
    revoice: { type: 'boolean' },
    director: { type: 'boolean' },
    'director-model': { type: 'string' },
    'director-effort': { type: 'string' },
    'director-review': { type: 'boolean' },
    'director-max-tokens': { type: 'string' },
    'director-rules': { type: 'string' },
    render: { type: 'string' },
    broll: { type: 'boolean' },
  },
})

const command = positionals[0]
if (flags.help || !command) {
  console.log(HELP)
  process.exit(command || flags.help ? 0 : 1)
}

const configPath = resolve(flags.config ?? join(HERE, 'config.json'))
const configDir = dirname(configPath)
const config = loadConfig()
const log = createLogger({ app: 'reel-lab', level: 'warn' })

function fail(message: string): never {
  console.error(`error: ${message}`)
  process.exit(1)
}

function loadStitch(file: Partial<Stitch> | undefined): Stitch {
  const stitch = { ...file } as Stitch
  for (const [key, [flag, low, high]] of Object.entries(STITCH_NUMBERS)) {
    const raw = flags[flag] ?? stitch[key as keyof typeof STITCH_NUMBERS]
    if (raw === undefined || raw === null) {
      stitch[key as keyof typeof STITCH_NUMBERS] = null
      continue
    }
    const n = Number(raw)
    if (!Number.isFinite(n) || n < low || n > high) fail(`${flag} must be from ${low} to ${high}`)
    stitch[key as keyof typeof STITCH_NUMBERS] = n
  }
  const trim = flags.trim ?? stitch.trim
  stitch.trim = trim ? oneOf('trim', trim, ['words', 'level', 'off'] as const) : null
  const buffer = flags['tail-buffer'] ?? stitch.tailBuffer
  stitch.tailBuffer = buffer ? buffer : null
  return stitch
}

function toNumber(name: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1) fail(`--${name} must be a whole number above 0`)
  return n
}

function oneOf<T extends string>(name: string, value: unknown, options: readonly T[]): T {
  if (typeof value === 'string' && (options as readonly string[]).includes(value)) return value as T
  return fail(`${name} must be one of ${options.join(', ')} (got ${String(value)})`)
}

function loadConfig(): Config {
  const file = existsSync(configPath)
    ? (JSON.parse(readFileSync(configPath, 'utf8')) as Partial<Config>)
    : {}
  const merged = { ...file } as Config
  if (flags.item) merged.item = flags.item
  if (flags.prompt) merged.prompt = flags.prompt
  if (flags.base) merged.base = flags.base as Config['base']
  if (flags.model) merged.model = flags.model as ClaudeModel
  if (flags.effort) merged.effort = flags.effort as ClaudeEffort
  if (flags.voice) merged.voice = flags.voice
  if (flags.tts) merged.tts = flags.tts as Config['tts']
  if (flags.out) merged.out = flags.out
  if (flags.tag) merged.tag = flags.tag
  if (flags.script) merged.script = flags.script
  if (flags['first-valid'] !== undefined) merged.firstValid = flags['first-valid']
  if (flags.natural !== undefined) merged.natural = flags.natural
  if (flags.director !== undefined) merged.director = flags.director
  if (flags['director-review'] !== undefined) merged.directorReview = flags['director-review']
  if (flags['director-model']) merged.directorModel = flags['director-model'] as ClaudeModel
  if (flags['director-effort']) merged.directorEffort = flags['director-effort'] as DirectorEffort
  if (flags['director-rules']) merged.directorRules = flags['director-rules']
  if (flags.render) merged.render = flags.render as Config['render']
  if (flags.broll !== undefined) merged.broll = flags.broll
  const maxTokens = flags['director-max-tokens'] ?? file.directorMaxTokens ?? null
  merged.directorMaxTokens =
    maxTokens === null ? null : toNumber('director-max-tokens', String(maxTokens), 1)
  if (
    merged.directorMaxTokens !== null &&
    (merged.directorMaxTokens < DIRECTOR_MIN_MAX_TOKENS ||
      merged.directorMaxTokens > DIRECTOR_MAX_MAX_TOKENS)
  )
    fail(`director max tokens must be ${DIRECTOR_MIN_MAX_TOKENS} to ${DIRECTOR_MAX_MAX_TOKENS}`)
  merged.director ??= null
  merged.directorReview ??= null
  merged.directorRules ??= null
  merged.directorModel = merged.directorModel
    ? oneOf('director model', merged.directorModel, CLAUDE_MODELS)
    : null
  merged.directorEffort = merged.directorEffort
    ? oneOf('director effort', merged.directorEffort, DIRECTOR_EFFORTS)
    : null
  merged.render = oneOf('render', merged.render ?? 'local', ['local', 'box'] as const)
  merged.broll ??= true
  merged.attempts = toNumber('attempts', flags.attempts, file.attempts ?? 3)
  merged.minWords = toNumber('min-words', flags['min-words'], file.minWords ?? 185)
  merged.maxWords = toNumber('max-words', flags['max-words'], file.maxWords ?? 240)
  merged.maxChars = toNumber('max-chars', flags['max-chars'], file.maxChars ?? 1500)
  const segments = flags.segments ?? file.segments ?? 'paragraphs'
  merged.segments =
    segments === 'paragraphs' ? 'paragraphs' : toNumber('segments', String(segments), 1)
  merged.prompt ??= 'none'
  merged.base = oneOf('base', merged.base ?? 'qwen', ['qwen', 'standard'] as const)
  merged.model = merged.model ? oneOf('model', merged.model, CLAUDE_MODELS) : null
  merged.effort = merged.effort ? oneOf('effort', merged.effort, CLAUDE_EFFORTS) : null
  merged.voice = oneOf('voice', merged.voice ?? 'genz', CHATTERBOX_VOICES)
  merged.tts = oneOf('tts', merged.tts ?? 'serve', ['serve', 'dev', 'prod'] as const)
  merged.natural ??= true
  merged.stitch = loadStitch(file.stitch)
  merged.firstValid ??= true
  merged.out ??= 'out'
  if (merged.minWords > merged.maxWords) fail('min words is above max words')
  return merged
}

/** Flags are relative to where you run the command, config values to the config file. */
function findPath(path: string): string {
  if (isAbsolute(path)) return path
  const fromCwd = resolve(path)
  return existsSync(fromCwd) ? fromCwd : resolve(configDir, path)
}

function loadEnv() {
  const path = flags.env ? resolve(flags.env) : join(REPO, '.env.local')
  if (existsSync(path)) process.loadEnvFile(path)
  else if (flags.env) fail(`env file not found: ${path}`)
}

function systemPrompt(): { text: string; layer: string } {
  const base = config.base === 'qwen' ? QWEN_SYSTEM_PROMPT : SYSTEM_PROMPT
  if (config.prompt === 'none') return { text: base, layer: 'none' }
  const path = findPath(config.prompt)
  if (!existsSync(path)) fail(`prompt file not found: ${path}`)
  return { text: `${base}\n\n${readFileSync(path, 'utf8').trim()}`, layer: basename(path) }
}

function connect() {
  const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL
  if (!connectionString) fail('DIRECT_URL or DATABASE_URL is not set (see --env)')
  return createDb({ connectionString, log, max: 1 })
}

async function listItems(db: Database) {
  const rows = (
    await sql<{ id: string; title: string; status: string; created_at: Date }>`
      select id, title, status, created_at from item where script is not null
      order by created_at desc limit 20`.execute(db)
  ).rows
  for (const r of rows) {
    console.log(`${r.id.slice(0, 8)}  ${r.status.padEnd(9)} ${r.title.slice(0, 80)}`)
  }
}

async function loadItem(db: Database, prefix: string) {
  const found = (
    await sql<Record<string, any>>`
      select id, title, kind, canonical_url, canonical_key from item
      where id::text like ${`${prefix}%`} limit 2`.execute(db)
  ).rows
  if (found.length === 0) fail(`no item starts with ${prefix}`)
  if (found.length > 1) fail(`more than one item starts with ${prefix}; use a longer prefix`)
  const item = found[0]!
  const chunks = (
    await sql<{ id: string; text: string }>`
      select id, text from evidence_chunk where item_id = ${item.id}
      order by mention_id, chunk_index`.execute(db)
  ).rows
  const mentions = (
    await sql<Record<string, any>>`
      select source, external_id, url, title, body, raw, author, score, num_comments, published_at
      from mention where item_id = ${item.id}`.execute(db)
  ).rows
  const brief = buildSourceBrief({
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
  })
  const sourceText = [
    brief.facts,
    item.title,
    item.canonical_url,
    ...mentions.map((m) => `${m.url} ${m.title ?? ''}`),
    ...chunks.map((c) => c.text),
  ].join('\n')
  const imageUrls = [
    ...allowedImageSet(
      mentions.map((m) => ({ source: m.source, externalId: m.external_id })),
      [...chunks.map((c) => c.text), ...mentions.map((m) => m.body ?? '')],
    ),
  ]
  return { item, chunks, brief, sourceText, imageUrls }
}

function narrationText(script: {
  hook: string
  beats: readonly { text: string }[]
  outro: string
}) {
  return [script.hook, ...script.beats.map((b) => b.text), script.outro].join('\n\n')
}

async function writeScript(db: Database, system: string): Promise<ScriptResult> {
  if (!config.item) fail('no item: pass --item or set "item" in the config')
  const { item, chunks, brief, sourceText, imageUrls } = await loadItem(db, config.item)
  const model = config.model ?? (await getSetting(db, SETTINGS.scriptModel, log))
  const effort = config.effort ?? (await getSetting(db, SETTINGS.scriptEffort, log))
  const { client } = createLlm({ apiKey: process.env.CLAUDE_API_KEY, model, effort }, log)
  const promptChunks = selectPromptChunks(chunks)
  const promptIds = new Set(promptChunks.map((c) => c.id))
  const limits = { min: config.minWords, max: config.maxWords, maxSpokenChars: config.maxChars }
  console.log(`item ${item.id.slice(0, 8)} "${item.title}"`)
  console.log(`model ${model} (${effort}), up to ${config.attempts} calls`)

  let rejection: string | undefined
  let previous: string | undefined
  let best: { value: GeneratedContent; style: StyleReport } | null = null
  let costUsd = 0
  let calls = 0
  for (let attempt = 1; attempt <= config.attempts; attempt++) {
    calls = attempt
    const res = await client.generate({
      system,
      user: buildUserPrompt({
        title: item.title,
        kind: item.kind,
        canonicalUrl: item.canonical_url,
        chunks: promptChunks,
        imageUrls,
        brief: brief.text,
        rejection,
        previous,
      }),
    })
    costUsd += claudeCostUsd(model, res.usage)
    const parsed = parseModelOutput(res.text, promptIds, sourceText, limits, STYLE_LIMITS)
    if (!parsed.ok) {
      rejection = parsed.reason
      previous = undefined
      console.log(`  call ${attempt}: rejected, ${parsed.reason.slice(0, 200)}`)
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
      previous = undefined
      console.log(`  call ${attempt}: unsafe, ${rejection.slice(0, 200)}`)
      continue
    }
    if (!best || parsed.style.issues.length <= best.style.issues.length) best = parsed
    const words = narrationWordCount(parsed.value.script)
    console.log(
      `  call ${attempt}: ok, ${words} words, grade ${parsed.style.readingGrade}, ${parsed.style.issues.length} style issues`,
    )
    if (config.firstValid || parsed.style.issues.length === 0) break
    rejection = `the facts and format are fine, but the script is not easy enough to follow. Keep the same facts and fix: ${parsed.style.issues.join('; ')}`
    previous = narrationText(parsed.value.script)
  }
  if (!best) fail(`no usable script after ${calls} calls: ${rejection}`)
  return { content: best.value, style: best.style, model, effort, calls, costUsd }
}

function saveScript(result: ScriptResult, tag: string, outDir: string, layer: string) {
  const words = narrationWordCount(result.content.script)
  const summary = `${words} words, grade ${result.style.readingGrade}, ${result.style.issues.length} style issues, ${result.calls} calls, $${result.costUsd.toFixed(4)}`
  const settings = { ...config, model: result.model, effort: result.effort, promptLayer: layer }
  writeFileSync(
    join(outDir, `${tag}.script.json`),
    JSON.stringify({ settings, summary, ...result }, null, 2),
  )
  const text = narrationText(result.content.script)
  const issues = result.style.issues.map((i) => `- ${i}`).join('\n')
  writeFileSync(
    join(outDir, `${tag}.script.txt`),
    `${result.model} (${result.effort}), prompt ${layer} on ${config.base}\n${summary}\n${issues}\n\n${text}\n`,
  )
  console.log(`\n${text}\n\n${summary}`)
  if (issues) console.log(issues)
}

function readScript(file: string): { script: ReelScript; item?: string } {
  const raw = JSON.parse(readFileSync(findPath(file), 'utf8')) as Record<string, any>
  const script = reelScriptSchema.parse(raw.content?.script ?? raw.script ?? raw)
  return { script, item: raw.settings?.item }
}

/** Audio saved next to a script by an earlier voice run, so a re-render costs no GPU. */
function savedNarration(dir: string, tag: string): Narration | null {
  const mp3 = join(dir, `${tag}.mp3`)
  const stats = join(dir, `${tag}.audio.json`)
  if (!existsSync(mp3) || !existsSync(stats)) return null
  const words = (JSON.parse(readFileSync(stats, 'utf8')) as { words?: TimedWord[] }).words
  return words?.length ? { audio: readFileSync(mp3), words } : null
}

/** The serve URL is never printed: it names the Modal account. */
function ttsUrl(): string {
  const dev = process.env.QWEN_DEV_URL?.trim().replace(/\/+$/, '')
  if (!dev) fail('QWEN_DEV_URL is not set (the `modal serve` URL of reelset-qwen-tts)')
  return config.tts === 'prod' ? dev.replace('-web-dev.', '-web.') : dev
}

const hideUrl = (text: string) => text.replace(/https:\/\/\S+/g, '<tts-url>')

async function startServe(): Promise<() => void> {
  console.log('starting the dev voice server (modal serve)...')
  const child = spawn('modal', ['serve', 'qwen_app.py'], {
    cwd: TTS_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  await new Promise<void>((ready, broke) => {
    const timer = setTimeout(
      () => broke(new Error('modal serve was not ready in 5 minutes')),
      SERVE_READY_MS,
    )
    const onData = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-4000)
      if (output.includes('Serving...')) {
        clearTimeout(timer)
        ready()
      }
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('error', (err) => {
      clearTimeout(timer)
      broke(new Error(`could not run modal: ${err.message}`))
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      broke(new Error(`modal serve stopped (code ${code}): ${hideUrl(output.slice(-500))}`))
    })
  }).catch((err: Error) => fail(err.message))
  return () => child.kill('SIGINT')
}

async function synthesize(url: string, body: object): Promise<Record<string, any>> {
  let lastError = ''
  for (let attempt = 1; attempt <= TTS_TRIES; attempt++) {
    try {
      const res = await fetch(`${url}/synthesize`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${process.env.CHATTERBOX_TOKEN}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TTS_TIMEOUT_MS),
      })
      const text = await res.text()
      if (res.ok) return JSON.parse(text) as Record<string, any>
      lastError = `status ${res.status}: ${hideUrl(text.slice(0, 300))}`
      if (res.status < 500) break
    } catch (err) {
      lastError = hideUrl(
        err instanceof Error ? `${err.message} ${String(err.cause ?? '')}` : String(err),
      )
    }
    console.log(
      `  voice try ${attempt} failed (${lastError})${attempt < TTS_TRIES ? ', retrying' : ''}`,
    )
  }
  return fail(`voice server failed: ${lastError}`)
}

/** Letters per second while talking, first third vs last third: shows the voice speeding up. */
function paceDrift(words: TimedWord[]): string {
  const letters = (t: string) => t.replace(/[^A-Za-z0-9]/g, '').length
  const n = words.length
  const rate = (part: TimedWord[]) => {
    const speech = part.reduce((s, w) => s + (w.end - w.start), 0)
    const gaps = part
      .slice(1)
      .reduce((s, w, i) => s + Math.min(Math.max(w.start - part[i]!.end, 0), 0.25), 0)
    return part.reduce((s, w) => s + letters(w.text), 0) / (speech + gaps)
  }
  const rates = [
    words.slice(0, n / 3),
    words.slice(n / 3, (2 * n) / 3),
    words.slice((2 * n) / 3),
  ].map(rate)
  const drift = 100 * (rates[2]! / rates[0]! - 1)
  return `${rates.map((r) => r.toFixed(1)).join(' -> ')} letters/s, drift ${drift >= 0 ? '+' : ''}${drift.toFixed(0)}%`
}

async function voice(script: ReelScript, tag: string, outDir: string): Promise<Narration> {
  if (!process.env.CHATTERBOX_TOKEN) fail('CHATTERBOX_TOKEN is not set')
  const url = ttsUrl()
  const segments = chatterboxSegments(speakableNumbers(script))
  const chunks =
    config.segments === 'paragraphs' ? segments.length : Math.min(config.segments, segments.length)
  const stop = config.tts === 'serve' ? await startServe() : () => {}
  try {
    console.log(
      `voicing ${segments.length} parts in ${chunks} take(s), voice ${config.voice}, natural ${config.natural}...`,
    )
    const stitch = Object.entries(config.stitch).filter(([, v]) => v !== null)
    if (stitch.length > 0)
      console.log(`stitch ${stitch.map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ')}`)
    const started = Date.now()
    const body = await synthesize(url, {
      segments,
      voice: config.voice,
      chunks,
      natural: config.natural,
      stitch: Object.fromEntries(Object.entries(config.stitch).filter(([, v]) => v !== null)),
    })
    const mp3 = join(outDir, `${tag}.mp3`)
    const audio = Buffer.from(String(body.audioBase64), 'base64')
    writeFileSync(mp3, audio)
    const wav = join(outDir, `${tag}.wav`)
    const ffmpeg = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', mp3, wav])
    const words = (body.words ?? []) as TimedWord[]
    const { audioBase64: _audio, ...stats } = body
    writeFileSync(
      join(outDir, `${tag}.audio.json`),
      JSON.stringify({ settings: config, segments, chunks, ...stats }, null, 2),
    )
    const seconds = Number(body.audioSeconds)
    console.log(
      `audio ${seconds.toFixed(1)}s in ${((Date.now() - started) / 1000).toFixed(0)}s on ${body.gpu}, $${Number(body.gpuUsd ?? 0).toFixed(4)}, ${body.retriedSegments ?? 0} retried takes`,
    )
    if (words.length >= 6) console.log(`pace ${paceDrift(words)}`)
    if (seconds > MAX_NARRATION_SECONDS)
      console.log(`warning: over the ${MAX_NARRATION_SECONDS}s reel cap`)
    console.log(ffmpeg.status === 0 ? `wav  ${wav}` : `mp3  ${mp3} (ffmpeg missing, no wav)`)
    return { audio, words }
  } finally {
    stop()
  }
}

async function directorConfig(db: Database): Promise<DirectorPayload | null> {
  const enabled = config.director ?? (await getSetting(db, SETTINGS.directorEnabled, log))
  if (!enabled) return null
  const [model, effort, maxTokens, review, rules, reviewPrompt, rows] = await Promise.all([
    config.directorModel ?? getSetting(db, SETTINGS.directorModel, log),
    config.directorEffort ?? getSetting(db, SETTINGS.directorEffort, log),
    config.directorMaxTokens ?? getSetting(db, SETTINGS.directorMaxTokens, log),
    config.directorReview ?? getSetting(db, SETTINGS.directorReview, log),
    getSetting(db, SETTINGS.directorRules, log),
    getSetting(db, SETTINGS.directorReviewPrompt, log),
    listSkills(db),
  ])
  let customRules: string | null = null
  if (config.directorRules) {
    const path = findPath(config.directorRules)
    if (!existsSync(path)) fail(`director rules file not found: ${path}`)
    customRules = readFileSync(path, 'utf8').trim()
  }
  const { skills, example } = selectSkills(rows)
  return {
    model,
    effort,
    maxTokens,
    review,
    rules: customRules ?? rules,
    reviewPrompt,
    skills,
    example,
  }
}

const memoryCache = () => {
  const mem = new Map<string, string>()
  return {
    async get(key: string) {
      const v = mem.get(key)
      return v === undefined ? null : ({ json: async () => JSON.parse(v) } as never)
    },
    async put(key: string, value: unknown) {
      mem.set(key, String(value))
      return null as never
    },
  }
}

async function buildRenderInput(
  db: Database,
  itemPrefix: string,
  script: ReelScript,
  narration: Narration,
): Promise<RenderInput> {
  const ids = (
    await sql<{
      id: string
    }>`select id from item where id::text like ${`${itemPrefix}%`} limit 2`.execute(db)
  ).rows
  if (ids.length !== 1) fail(`${ids.length} items start with ${itemPrefix}`)
  const item = (await createRenderStore(db, log).loadItem(ids[0]!.id))!
  const spoken = speakableNumbers(script)
  const director = await directorConfig(db)
  const broll =
    config.broll && process.env.PEXELS_API_KEY
      ? await pickBroll(
          {
            apiKey: process.env.PEXELS_API_KEY,
            fetch: (u, i) => fetch(u, i),
            cache: memoryCache(),
            log,
          },
          spoken.beats,
          { source: item.source, title: item.title },
        ).catch(() => [])
      : []
  if (config.broll && !process.env.PEXELS_API_KEY) console.log('note: no PEXELS_API_KEY, no b-roll')
  console.log(
    director
      ? `director ${director.model} (${director.effort}), review ${director.review}, ${director.skills.length} skills${config.directorRules ? ', custom rules' : ''}`
      : 'director off: plain template renderer',
  )
  return {
    jobId: `lab${Date.now().toString(36)}${item.id.replace(/-/g, '').slice(0, 12)}`,
    script: spoken,
    title: containerTitle(item.title),
    sourceLabel: item.sourceLabel,
    imageUrls: collectImageUrls(spoken),
    voice: DEFAULT_VOICE,
    narration: { audioBase64: audioToBase64(narration.audio), words: wordsToJson(narration.words) },
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
}

function renderLocal(input: RenderInput, tag: string, outDir: string): Record<string, any> {
  const payload = join(outDir, `${tag}.payload.json`)
  const jobDir = join(outDir, `${tag}-render`)
  writeFileSync(payload, JSON.stringify(input))
  console.log('rendering on this Mac (a few minutes)...')
  const python = process.env.REEL_LAB_PYTHON ?? 'python3'
  const run = spawnSync(python, ['tools/render_local.py', payload, jobDir], {
    cwd: RENDER_DIR,
    env: process.env,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  })
  writeFileSync(join(outDir, `${tag}.render.log`), `${run.stderr ?? ''}\n${run.stdout ?? ''}`)
  if (run.status !== 0) {
    const tail = (run.stderr ?? run.error?.message ?? '').trim().split('\n').slice(-12).join('\n')
    fail(`local render failed (log: ${join(outDir, `${tag}.render.log`)})\n${tail}`)
  }
  const meta = JSON.parse(run.stdout.slice(run.stdout.indexOf('{'))) as Record<string, any>
  copyFileSync(join(jobDir, 'video.mp4'), join(outDir, `${tag}.mp4`))
  copyFileSync(join(jobDir, 'poster.jpg'), join(outDir, `${tag}.jpg`))
  return meta
}

async function renderOnBox(input: RenderInput, tag: string, outDir: string) {
  const token = process.env.RENDER_BOX_TOKEN
  if (!token) fail('RENDER_BOX_TOKEN is not set (needed for --render box)')
  const boxes = parseBoxUrls(process.env.BOX_URLS ?? DEFAULT_BOXES)
  const client = createContainerClient(createBoxFetcher({ baseUrls: boxes, token, log }), log)
  console.log(`rendering on the render boxes (${boxes.length})...`)
  let meta: RenderMetadata | null = null
  for (let attempt = 1; !meta; attempt++) {
    try {
      meta = await client.render(input)
    } catch (err) {
      const busy =
        err instanceof RenderJobError && (err.code === 'busy' || err.code === 'in_progress')
      if (!busy || attempt >= BOX_BUSY_TRIES) throw err
      console.log(`  boxes busy, waiting (${attempt}/${BOX_BUSY_TRIES})`)
      await new Promise((r) => setTimeout(r, BOX_BUSY_WAIT_MS))
    }
  }
  try {
    writeFileSync(
      join(outDir, `${tag}.mp4`),
      Buffer.from(await client.download(input.jobId, 'video')),
    )
    writeFileSync(
      join(outDir, `${tag}.jpg`),
      Buffer.from(await client.download(input.jobId, 'poster')),
    )
  } finally {
    await client.remove(input.jobId).catch(() => undefined)
  }
  return meta as Record<string, any>
}

async function renderVideo(
  db: Database,
  itemPrefix: string,
  script: ReelScript,
  narration: Narration,
  tag: string,
  outDir: string,
) {
  const input = await buildRenderInput(db, itemPrefix, script, narration)
  const started = Date.now()
  const meta =
    config.render === 'box'
      ? await renderOnBox(input, tag, outDir)
      : renderLocal(input, tag, outDir)
  writeFileSync(
    join(outDir, `${tag}.video.json`),
    JSON.stringify({ settings: config, ...meta }, null, 2),
  )
  const d = meta.director as Record<string, any> | undefined
  const directorCost =
    d?.used && CLAUDE_MODELS.includes(d.model)
      ? claudeCostUsd(d.model, {
          inputTokens: d.inputTokens,
          outputTokens: d.outputTokens,
          cacheReadTokens: d.cacheReadTokens,
          cacheWriteTokens: d.cacheWriteTokens,
        })
      : 0
  const wall = ((Date.now() - started) / 1000).toFixed(0)
  console.log(
    `video ${(meta.durationMs / 1000).toFixed(1)}s, ${(meta.bytes / 1e6).toFixed(1)} MB, rendered in ${wall}s`,
  )
  if (d) {
    console.log(
      d.used
        ? `director drew ${d.scenes} scenes (${d.sceneErrors} errors), $${directorCost.toFixed(4)}`
        : `director fell back to the template (${d.fallbackReason})`,
    )
  }
  console.log(`mp4  ${join(outDir, `${tag}.mp4`)}`)
}

async function main() {
  loadEnv()
  const outDir = findPath(config.out)
  mkdirSync(outDir, { recursive: true })
  const stamp = new Date().toISOString().slice(5, 16).replace(/[-:T]/g, '')
  const tag = config.tag ?? `${config.item ?? 'script'}-${stamp}`

  if (command === 'prompt') {
    console.log(systemPrompt().text)
    return
  }
  if (command === 'voice' || command === 'render') {
    if (!config.script) fail(`${command} needs --script <file.script.json>`)
    const saved = readScript(config.script)
    const savedTag = config.tag ?? basename(config.script).split('.')[0]!
    if (command === 'voice') {
      await voice(saved.script, savedTag, outDir)
      return
    }
    const itemPrefix = flags.item ?? saved.item ?? config.item
    if (!itemPrefix) fail('no item for this script: pass --item')
    const reuse = flags.revoice ? null : savedNarration(dirname(findPath(config.script)), savedTag)
    if (reuse) console.log('using the audio already saved for this script')
    const narration = reuse ?? (await voice(saved.script, savedTag, outDir))
    const { db, close } = connect()
    try {
      await renderVideo(db, itemPrefix, saved.script, narration, savedTag, outDir)
    } finally {
      await close()
    }
    return
  }
  if (!['script', 'both', 'video', 'items'].includes(command!))
    fail(`unknown command ${command} (see --help)`)

  const { db, close } = connect()
  let result: ScriptResult
  try {
    if (command === 'items') return await listItems(db)
    const { text, layer } = systemPrompt()
    result = await writeScript(db, text)
    saveScript(result, tag, outDir, layer)
  } finally {
    await close()
  }
  console.log(`\nscript ${join(outDir, `${tag}.script.txt`)}`)
  if (command === 'script') return
  const script = reelScriptSchema.parse(result.content.script)
  const narration = await voice(script, tag, outDir)
  if (command !== 'video') return
  const render = connect()
  try {
    await renderVideo(render.db, config.item!, script, narration, tag, outDir)
  } finally {
    await render.close()
  }
}

await main()
