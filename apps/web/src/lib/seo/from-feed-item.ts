import type { FeedItemDto } from '@/lib/api-types'
import type { ReelPageData } from './types'

/** Everything the feed already carries, so details render before /api/reel/[id] answers. */
export function reelFromFeedItem(item: FeedItemDto): ReelPageData {
  return {
    id: item.id,
    visibility: 'public',
    title: item.title,
    tldr: item.tldr,
    hook: null,
    transcript: null,
    topics: item.topics,
    kind: item.kind,
    canonicalUrl: item.canonicalUrl,
    publishedAt: item.publishedAt,
    renderedAt: null,
    videoUrl: item.videoUrl,
    posterUrl: item.posterUrl,
    durationMs: item.durationMs,
    facts: [],
    mentions: item.mentions.map((m) => ({
      source: m.source,
      url: m.url,
      title: null,
      author: null,
      score: m.score,
      comments: null,
    })),
  }
}
