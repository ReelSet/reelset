export const RETURN_PATH_HEADER = 'x-return-path'

export function safeReturnPath(raw: string | null | undefined, fallback = '/'): string {
  if (!raw) return fallback
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return fallback
  if (/[\u0000-\u001f]/.test(raw)) return fallback
  return raw
}

export function buildLoginUrl(returnTo: string): string {
  return `/login?next=${encodeURIComponent(safeReturnPath(returnTo))}`
}

export function reelPath(itemId: string): string {
  return `/?reel=${encodeURIComponent(itemId)}`
}
