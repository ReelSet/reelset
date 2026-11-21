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

const ORIGIN_CC = 'x-origin-cache-control'

// The zone's Browser Cache TTL (4h) overwrites cache-control on Cache API hits, so the
// origin value rides along in a side header and is restored when served.
export function forEdgeStore(res: Response): Response {
  const out = new Response(res.body, res)
  const cc = res.headers.get('cache-control')
  if (cc) out.headers.set(ORIGIN_CC, cc)
  return out
}

export function fromEdgeStore(res: Response): Response {
  const out = new Response(res.body, res)
  const cc = res.headers.get(ORIGIN_CC)
  if (cc) out.headers.set('cache-control', cc)
  out.headers.delete(ORIGIN_CC)
  return out
}

/** Host, path and sorted query; cookies, headers and the Range header never split entries. */
export function edgeCacheKey(req: Request): string {
  const url = new URL(req.url)
  url.searchParams.sort()
  url.hash = ''
  return `https://${url.host}${url.pathname}${url.search}`
}

/** Parses a single `bytes=` range against a known size; null when absent, multi-part or unsatisfiable. */
export function parseByteRange(
  header: string,
  size: number,
): { start: number; end: number } | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m || (m[1] === '' && m[2] === '') || size <= 0) return null
  let start: number
  let end: number
  if (m[1] === '') {
    start = Math.max(0, size - Number(m[2]))
    end = size - 1
  } else {
    start = Number(m[1])
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1)
  }
  return start <= end && start < size ? { start, end } : null
}

/**
 * Answers a Range request from a full 200: production `caches.default.match` returns the whole
 * body, and Safari will not play video from a server that ignores Range.
 */
export async function withRange(full: Response, range: string | null): Promise<Response> {
  if (!range || full.status !== 200) return full
  const body = await full.arrayBuffer()
  const r = parseByteRange(range, body.byteLength)
  const headers = new Headers(full.headers)
  headers.set('accept-ranges', 'bytes')
  if (!r) {
    headers.set('content-range', `bytes */${body.byteLength}`)
    headers.delete('content-length')
    return new Response(null, { status: 416, headers })
  }
  headers.set('content-range', `bytes ${r.start}-${r.end}/${body.byteLength}`)
  headers.set('content-length', String(r.end - r.start + 1))
  return new Response(body.slice(r.start, r.end + 1), { status: 206, headers })
}
