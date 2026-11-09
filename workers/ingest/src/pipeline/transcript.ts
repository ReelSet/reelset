import type { Logger } from '@reelset/core'
import { z } from 'zod'

const TRANSCRIPT_URL = 'https://render.internal/transcript'

const responseSchema = z.discriminatedUnion('status', [
  z.looseObject({
    status: z.literal('ok'),
    language: z.string().nullish(),
    segments: z.array(
      z.looseObject({
        text: z.string(),
        start: z.number().nullish(),
        duration: z.number().nullish(),
      }),
    ),
  }),
  z.looseObject({
    status: z.literal('unavailable'),
    reason: z.enum(['blocked', 'no_captions', 'error']),
  }),
])

export type TranscriptResult =
  | { status: 'ok'; language: string | null; text: string }
  | { status: 'unavailable'; reason: 'blocked' | 'no_captions' | 'error' }

export type TranscriptClient = {
  fetch: (videoId: string) => Promise<TranscriptResult>
}

export function parseTranscriptResponse(json: unknown): TranscriptResult {
  const parsed = responseSchema.parse(json)
  if (parsed.status === 'unavailable') return { status: 'unavailable', reason: parsed.reason }
  const text = parsed.segments
    .map((s) => s.text.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' ')
  if (!text) return { status: 'unavailable', reason: 'no_captions' }
  return { status: 'ok', language: parsed.language ?? null, text }
}

export function createTranscriptClient(
  fetcher: Pick<Fetcher, 'fetch'>,
  log: Logger,
): TranscriptClient {
  return {
    fetch: async (videoId) => {
      const startedAt = performance.now()
      const res = await fetcher.fetch(TRANSCRIPT_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ videoId }),
      })
      log.info(
        { videoId, status: res.status, durationMs: Math.round(performance.now() - startedAt) },
        'transcript service responded',
      )
      if (!res.ok) throw new Error(`transcript service returned HTTP ${res.status}`)
      return parseTranscriptResponse(await res.json())
    },
  }
}
