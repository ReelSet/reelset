export const RENDER_ERROR_CODES = [
  'tts_unavailable',
  'ffmpeg_failed',
  'invalid_input',
  'too_large',
  'busy',
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
