import type { ChatterboxVoice, Logger, ReelScript } from '@reelset/core'
import { RenderJobError } from './errors'
import type { Narration, TimedWord } from './tts'

export const CHATTERBOX_TIMEOUT_MS = 8 * 60 * 1000
const MAX_AUDIO_BASE64_CHARS = 8_000_000

export type ChatterboxConfig = {
  url: string
  token: string
  voice: ChatterboxVoice
  fetch: (url: string, init: RequestInit) => Promise<Response>
  timeoutMs?: number
  /** Which Modal narrator answers; both speak the same contract. Defaults to chatterbox. */
  engine?: ModalEngine
  /** Qwen only: how the script is split into takes and joined back up. Absent: the service defaults. */
  takes?: QwenTakes
}

export type QwenStitch = {
  pause: number
  edgePause: number
  trim: 'words' | 'level' | 'off'
  trimDb: number
  leadKeep: number
  tailKeep: number
  fadeInMs: number
  fadeOutMs: number
  tailBuffer: string
}

export type QwenTakes = { maxTakes: number; natural: boolean; stitch: QwenStitch }

/** Paragraphs voiced in up to 4 takes with the voice's own pauses, trimmed where the audio goes
 * quiet and joined with 0.35 s gaps (0.55 s after the hook and before the outro). Each take reads a
 * throwaway "okay." after its last word, cut off again, so that word is never clipped. Tuned by ear
 * with scripts/reel-lab. */
export const QWEN_TAKES: QwenTakes = {
  maxTakes: 4,
  natural: true,
  stitch: {
    pause: 0.35,
    edgePause: 0.55,
    trim: 'level',
    trimDb: -45,
    leadKeep: 0.06,
    tailKeep: 0.04,
    fadeInMs: 10,
    fadeOutMs: 18,
    tailBuffer: 'okay.',
  },
}

/** The request body: segments and voice, plus the take settings when given. */
export function narrationRequest(
  segments: string[],
  voice: string,
  takes: QwenTakes | undefined,
): Record<string, unknown> {
  if (!takes) return { segments, voice }
  return {
    segments,
    voice,
    chunks: Math.max(1, Math.min(takes.maxTakes, segments.length)),
    natural: takes.natural,
    stitch: takes.stitch,
  }
}

export type ModalEngine = 'chatterbox' | 'qwen'

const errorFields = (err: unknown) => ({
  err: err instanceof Error ? { name: err.name, message: err.message } : String(err),
})

/** One segment per spoken unit, so the model pauses between hook, beats and outro. */
export function chatterboxSegments(script: ReelScript): string[] {
  return [script.hook, ...script.beats.map((beat) => beat.text), script.outro]
    .map((text) => text.trim())
    .filter(Boolean)
}

function parseWords(raw: unknown): TimedWord[] | null {
  if (!Array.isArray(raw)) return null
  const words: TimedWord[] = []
  let previous = 0
  for (const entry of raw) {
    const { text, start, end } = (entry ?? {}) as Record<string, unknown>
    if (typeof text !== 'string' || typeof start !== 'number' || typeof end !== 'number')
      return null
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0) return null
    const from = Math.max(start, previous)
    const to = Math.max(end, from)
    words.push({ text, start: from, end: to })
    previous = from
  }
  return words
}

function decodeBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0))
}

/** GPU narrators price their own request (Qwen reports gpuUsd); Chatterbox on CPU reports none. */
function reportedCostUsd(gpuUsd: unknown): number {
  return typeof gpuUsd === 'number' && Number.isFinite(gpuUsd) && gpuUsd > 0 ? gpuUsd : 0
}

/** Narration from a Modal narrator (Chatterbox or Qwen): audio plus one timed word per script token. Any failure throws tts_unavailable so the caller falls back. */
export async function generateChatterbox(
  config: ChatterboxConfig,
  script: ReelScript,
  log: Logger,
): Promise<Narration> {
  const engine = config.engine ?? 'chatterbox'
  const segments = chatterboxSegments(script)
  const expectedWords = segments.join(' ').split(/\s+/).filter(Boolean).length
  const started = Date.now()
  const fail = (reason: string, extra: object = {}): never => {
    log.error(
      { engine, reason, voice: config.voice, ms: Date.now() - started, ...extra },
      `${engine} narration failed`,
    )
    throw new RenderJobError('tts_unavailable', `${engine} tts failed: ${reason}`)
  }

  let response: Response
  try {
    response = await config.fetch(config.url, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(narrationRequest(segments, config.voice, config.takes)),
      signal: AbortSignal.timeout(config.timeoutMs ?? CHATTERBOX_TIMEOUT_MS),
    })
  } catch (err) {
    return fail('request_failed', errorFields(err))
  }
  if (!response.ok) return fail('bad_status', { status: response.status })

  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null
  const audioBase64 = body?.audioBase64
  const audioSeconds = body?.audioSeconds
  if (
    typeof audioBase64 !== 'string' ||
    audioBase64.length === 0 ||
    audioBase64.length > MAX_AUDIO_BASE64_CHARS ||
    typeof audioSeconds !== 'number' ||
    !(audioSeconds > 0)
  ) {
    return fail('bad_body')
  }
  const words = parseWords(body?.words)
  if (!words || words.length !== expectedWords) {
    return fail('bad_words', { expectedWords, got: words?.length ?? null })
  }
  let audio: Uint8Array
  try {
    audio = decodeBase64(audioBase64)
  } catch {
    return fail('bad_audio')
  }
  const chars = segments.join(' ').length
  const costUsd = reportedCostUsd(body?.gpuUsd)
  log.info(
    {
      provider: engine,
      voice: config.voice,
      chars,
      audioSeconds,
      synthSeconds: body?.synthSeconds,
      takes: body?.takes,
      natural: body?.natural,
      gpu: body?.gpu,
      gpuSeconds: body?.gpuSeconds,
      retriedSegments: body?.retriedSegments,
      unresolvedSegments: body?.unresolvedSegments,
      costUsd,
      ms: Date.now() - started,
    },
    `${engine} narration ready`,
  )
  return {
    audio,
    words,
    chars,
    audioSeconds,
    costUsd,
    alignment: 'aligned',
    spoken: [],
  }
}
