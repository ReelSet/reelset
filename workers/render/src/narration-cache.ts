import { z } from 'zod'
import { errorFields, sha256Hex, type Logger, type ReelScript } from '@reelset/core'
import { audioToBase64, type Narration } from './tts'

export type RemoteProvider = 'aura2' | 'chatterbox' | 'qwen'
export type NarrationCache = Pick<R2Bucket, 'get' | 'put' | 'delete'>
export type CachedNarration = { narration: Narration; script: ReelScript; provider: RemoteProvider }

export const NARRATION_CACHE_PREFIX = 'narration-cache/'

export const narrationCacheKey = (renderKey: string) => `${NARRATION_CACHE_PREFIX}${renderKey}.json`

const timed = z.object({ text: z.string(), start: z.number(), end: z.number() })
const spoken = z.object({ word: z.string(), start: z.number(), end: z.number() })
const entrySchema = z.object({
  sourceHash: z.string(),
  provider: z.enum(['aura2', 'chatterbox', 'qwen']),
  script: z.record(z.string(), z.unknown()),
  narration: z.object({
    audioBase64: z.string().min(1),
    words: z.array(timed),
    chars: z.number(),
    audioSeconds: z.number().positive(),
    costUsd: z.number(),
    alignment: z.enum(['aligned', 'proportional']),
    spoken: z.array(spoken),
  }),
})

const sourceHash = (script: ReelScript) => sha256Hex(JSON.stringify(script))

function decodeBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0))
}

/**
 * Narration voiced by an earlier delivery of this render (a busy box defers the job after the voice
 * is paid for), or null. A script changed since then is never reused.
 */
export async function loadNarration(
  media: NarrationCache,
  renderKey: string,
  script: ReelScript,
  log: Logger,
): Promise<CachedNarration | null> {
  try {
    const object = await media.get(narrationCacheKey(renderKey))
    if (!object) return null
    const parsed = entrySchema.safeParse(JSON.parse(await object.text()))
    if (!parsed.success) {
      log.warn({ issues: parsed.error.issues.length }, 'cached narration unreadable, voicing again')
      return null
    }
    if (parsed.data.sourceHash !== (await sourceHash(script))) {
      log.info('cached narration is for an older script, voicing again')
      return null
    }
    const { narration, provider } = parsed.data
    return {
      provider,
      script: parsed.data.script as ReelScript,
      narration: { ...narration, audio: decodeBase64(narration.audioBase64) },
    }
  } catch (err) {
    log.warn(errorFields(err), 'cached narration lookup failed, voicing again')
    return null
  }
}

/** Keeps a paid-for narration until the render finishes; a failed save only costs a re-voice. */
export async function saveNarration(
  media: NarrationCache,
  renderKey: string,
  source: ReelScript,
  cached: CachedNarration,
  log: Logger,
): Promise<void> {
  try {
    const { audio, ...rest } = cached.narration
    const entry = {
      sourceHash: await sourceHash(source),
      provider: cached.provider,
      script: cached.script,
      narration: { ...rest, audioBase64: audioToBase64(audio) },
    }
    await media.put(narrationCacheKey(renderKey), JSON.stringify(entry), {
      httpMetadata: { contentType: 'application/json' },
    })
  } catch (err) {
    log.warn(errorFields(err), 'narration not cached, a retry will voice again')
  }
}

export async function dropNarration(
  media: NarrationCache,
  renderKey: string,
  log: Logger,
): Promise<void> {
  try {
    await media.delete(narrationCacheKey(renderKey))
  } catch (err) {
    log.warn(errorFields(err), 'cached narration not deleted, the bucket lifecycle expires it')
  }
}
