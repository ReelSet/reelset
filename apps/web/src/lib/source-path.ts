// Client-safe. The topic pages serve `?source=` filters from internal path segments so each
// variant is its own cached page: proxy.ts rewrites `/t?source=x` to `/t/by/x` and
// `/t/<topic>?source=x` to `/t/<topic>/by/x`. The pages validate the source themselves.

export const SOURCE_SEGMENT = 'by'

const SOURCE_SHAPE = /^[a-z]{2,12}$/
const TOPIC_SHAPE = /^[^/]+$/

export function sourceRewritePath(pathname: string, source: string | null): string | null {
  if (!source || !SOURCE_SHAPE.test(source)) return null
  if (pathname === '/t') return `/t/${SOURCE_SEGMENT}/${source}`
  const topic = pathname.startsWith('/t/') ? pathname.slice(3) : null
  if (!topic || !TOPIC_SHAPE.test(topic)) return null
  return `/t/${topic}/${SOURCE_SEGMENT}/${source}`
}
