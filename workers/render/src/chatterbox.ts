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
}

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

/** Narration from the Chatterbox service: audio plus one timed word per script token. Any failure throws tts_unavailable so the caller falls back. */
export async function generateChatterbox(
  config: ChatterboxConfig,
  script: ReelScript,
  log: Logger,
): Promise<Narration> {
  const segments = chatterboxSegments(script)
  const expectedWords = segments.join(' ').split(/\s+/).filter(Boolean).length
  const started = Date.now()
  const fail = (reason: string, extra: object = {}): never => {
    log.error(
      { reason, voice: config.voice, ms: Date.now() - started, ...extra },
      'chatterbox narration failed',
    )
    throw new RenderJobError('tts_unavailable', `chatterbox tts failed: ${reason}`)
  }

  let response: Response
  try {
    response = await config.fetch(config.url, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ segments, voice: config.voice }),
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
  log.info(
    {
      provider: 'chatterbox',
      voice: config.voice,
      chars,
      audioSeconds,
      synthSeconds: body?.synthSeconds,
      ms: Date.now() - started,
    },
    'chatterbox narration ready',
  )
  return {
    audio,
    words,
    chars,
    audioSeconds,
    costUsd: 0,
    alignment: 'aligned',
    spoken: [],
  }
}
