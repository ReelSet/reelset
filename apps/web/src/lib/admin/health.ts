export const TRANSCRIPT_WINDOW = 20
export const TRANSCRIPT_MIN_ATTEMPTS = 10

// Error code the render worker stores in render.error when edge-tts fails.
export const TTS_ERROR_CODE = 'tts_unavailable'

// Despite the name this is a plain ratio; callers pass failures to get a failure rate.
export function successRate(ok: number, total: number): number | null {
  return total > 0 ? ok / total : null
}

// Same key core's sendAlert writes; the admin panel only reads it.
export const YOUTUBE_ALERT_KEY = 'alert_last_sent:youtube_search_failing'

export function parseAlertLastSent(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const date = new Date(raw)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export function transcriptStats(outcomes: readonly ('ok' | 'unavailable')[]) {
  const window = outcomes.slice(0, TRANSCRIPT_WINDOW)
  const ok = window.filter((o) => o === 'ok').length
  return {
    attempts: window.length,
    rate: successRate(ok, window.length),
    enoughData: window.length >= TRANSCRIPT_MIN_ATTEMPTS,
  }
}
