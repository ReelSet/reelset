import { SOURCES, type Source } from '@reelset/core'
import { githubAdapter } from './sources/github'
import { hackerNewsAdapter } from './sources/hacker-news'
import { newsAdapter } from './sources/news'
import { redditAdapter } from './sources/reddit'
import { youtubeAdapter } from './sources/youtube'
import type { SourceAdapter } from './types'

export const ADAPTERS: readonly SourceAdapter[] = [
  hackerNewsAdapter,
  redditAdapter,
  githubAdapter,
  youtubeAdapter,
  newsAdapter,
]

export function assertRegistryComplete(adapters: readonly SourceAdapter[] = ADAPTERS): void {
  const registered = new Set<Source>(adapters.map((a) => a.source))
  if (registered.size !== adapters.length) throw new Error('duplicate source adapter registered')
  const missing = SOURCES.filter((s) => !registered.has(s))
  if (missing.length > 0)
    throw new Error(`no adapter registered for sources: ${missing.join(', ')}`)
}

assertRegistryComplete()
