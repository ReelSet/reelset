import { CONTENT_SIGNAL } from '@/lib/seo/robots-txt'

const REEL_MD = /^\/r\/([^/]+)\.md$/
const REEL_PAGE = /^\/r\/([^/]+)\/?$/

function qualityOf(accept: string, type: string): number {
  let best = 0
  for (const range of accept.split(',')) {
    const [media, ...params] = range.split(';')
    if (media?.trim().toLowerCase() !== type) continue
    const q = params
      .map((p) => p.trim().toLowerCase())
      .find((p) => p.startsWith('q='))
      ?.slice(2)
    const value = q === undefined ? 1 : Number(q)
    best = Math.max(best, Number.isFinite(value) ? value : 0)
  }
  return best
}

/** True only when the client names text/markdown and ranks it at least as high as text/html. */
export function wantsMarkdown(accept: string | null): boolean {
  if (!accept) return false
  const markdown = qualityOf(accept, 'text/markdown')
  return markdown > 0 && markdown >= qualityOf(accept, 'text/html')
}

/** Internal route that serves the markdown of a page, or null when the request stays HTML. */
export function markdownRewritePath(pathname: string, accept: string | null): string | null {
  if (pathname === '/index.md') return '/api/md/home'
  const file = REEL_MD.exec(pathname)
  if (file) return `/api/md/r/${file[1]}`
  if (!wantsMarkdown(accept)) return null
  if (pathname === '/') return '/api/md/home'
  const page = REEL_PAGE.exec(pathname)
  return page ? `/api/md/r/${page[1]}` : null
}

export function markdownResponse(
  body: string,
  init: { status?: number; noindex?: boolean } = {},
): Response {
  const status = init.status ?? 200
  const headers: Record<string, string> = {
    'content-type': 'text/markdown; charset=utf-8',
    vary: 'Accept',
    // Rough 4-characters-per-token estimate; agents only use it to size their context budget.
    'x-markdown-tokens': String(Math.ceil(body.length / 4)),
    'content-signal': CONTENT_SIGNAL,
    'cache-control':
      status === 200
        ? 'public, s-maxage=3600, stale-while-revalidate=86400'
        : 'public, s-maxage=300',
  }
  if (init.noindex) headers['x-robots-tag'] = 'noindex'
  return new Response(body, { status, headers })
}
