// Client-safe. The topic pages serve `?source=` filters from internal path segments so each
// variant is its own cached page: proxy.ts rewrites `/t?source=x` to `/t/by/x` and
// `/t/<topic>?source=x` to `/t/<topic>/by/x`. Only real sources get a segment, so crawlers
// cannot mint one cached page per made-up source.
import { SOURCES } from '@reelset/core'

export const SOURCE_SEGMENT = 'by'

const KNOWN = new Set<string>(SOURCES)
const TOPIC_SHAPE = /^[^/]+$/
const SOURCE_PATH = /^\/t\/(?:[^/]+\/)?by\/([^/]+)\/?$/

export function sourceRewritePath(pathname: string, source: string | null): string | null {
  if (!source || !KNOWN.has(source)) return null
  if (pathname === '/t') return `/t/${SOURCE_SEGMENT}/${source}`
  const topic = pathname.startsWith('/t/') ? pathname.slice(3) : null
  if (!topic || !TOPIC_SHAPE.test(topic)) return null
  return `/t/${topic}/${SOURCE_SEGMENT}/${source}`
}

/** True for a direct hit on a source segment that names no real source (`/t/by/zz`). */
export function isUnknownSourcePath(pathname: string): boolean {
  const match = SOURCE_PATH.exec(pathname)
  return !!match && !KNOWN.has(match[1]!)
}
