/**
 * Which requests the Worker serves from the colo's Cache API. On Workers the Worker is the
 * origin, so `s-maxage` alone caches nothing; ISR HTML stays on OpenNext's own cache.
 */
const PREFIXES = ['/api/reel/', '/api/avatar/', '/api/showcase/']
const EXACT = new Set(['/llms.txt', '/llms-full.txt'])

const AUTH_COOKIE = /(?:^|;\s*)sb-[^=]*-auth-token/

export function isEdgeCacheableRequest(req: Request, adminHost: string | undefined): boolean {
  if (req.method !== 'GET') return false
  const url = new URL(req.url)
  if (adminHost && url.hostname === adminHost) return false
  if (!EXACT.has(url.pathname) && !PREFIXES.some((p) => url.pathname.startsWith(p))) return false
  if (req.headers.has('authorization') || req.headers.has('rsc')) return false
  return !AUTH_COOKIE.test(req.headers.get('cookie') ?? '')
}

export function isEdgeCacheableResponse(res: Response): boolean {
  if (res.status !== 200 || res.headers.has('set-cookie')) return false
  const cc = (res.headers.get('cache-control') ?? '').toLowerCase()
  return /\bpublic\b/.test(cc) && /\bs-maxage=\d+/.test(cc) && !/\b(?:private|no-store)\b/.test(cc)
}

/** Host, path and sorted query; cookies, headers and the Range header never split entries. */
export function edgeCacheKey(req: Request): string {
  const url = new URL(req.url)
  url.searchParams.sort()
  url.hash = ''
  return `https://${url.host}${url.pathname}${url.search}`
}
