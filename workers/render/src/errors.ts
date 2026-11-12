export const RENDER_ERROR_CODES = [
  'tts_unavailable',
  'ffmpeg_failed',
  'invalid_input',
  'too_large',
  'busy',
  'in_progress',
  'container_unreachable',
  'bad_container_response',
  'upload_failed',
  'script_invalid',
  'stale_container_template',
] as const
export type RenderErrorCode = (typeof RENDER_ERROR_CODES)[number]

const PERMANENT: ReadonlySet<RenderErrorCode> = new Set([
  'invalid_input',
  'too_large',
  'script_invalid',
])

export const RETRYABLE_FAILURE_CODES: RenderErrorCode[] = RENDER_ERROR_CODES.filter(
  (code) => !PERMANENT.has(code) && code !== 'stale_container_template',
)

/** The box has no free slot, or is already rendering this very job: wait and re-check, never a failure. */
export function isBusyCode(code: RenderErrorCode | null): boolean {
  return code === 'busy' || code === 'in_progress'
}

export function isRetryable(code: RenderErrorCode): boolean {
  return !PERMANENT.has(code)
}

export function parseErrorCode(value: unknown): RenderErrorCode | null {
  return RENDER_ERROR_CODES.find((code) => code === value) ?? null
}

export class RenderJobError extends Error {
  constructor(
    readonly code: RenderErrorCode,
    message?: string,
  ) {
    super(message ?? code)
    this.name = 'RenderJobError'
  }
}
