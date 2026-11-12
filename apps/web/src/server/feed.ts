import type { Database, Logger } from '@reelset/core'
import type { FeedItemDto, FeedResponse } from '@/lib/api-types'
import { mediaUrl } from '@/lib/media'
import { DEFAULT_FEED_LIMIT } from '@/lib/ranking/cursor'
import { getFeedItem, rankFeed, type RankedItem } from '@/lib/ranking'

export function toFeedDto(item: RankedItem, base: string): FeedItemDto {
  return {
    id: item.id,
    title: item.title,
    tldr: item.tldr,
    transcript: item.transcript,
    topics: item.topics,
    kind: item.kind,
    canonicalUrl: item.canonicalUrl,
    score: item.score,
    publishedAt: item.publishedAt,
    videoUrl: mediaUrl(base, item.videoKey) ?? '',
    posterUrl: mediaUrl(base, item.posterKey),
    durationMs: item.durationMs,
    likeCount: item.likeCount,
    liked: item.liked,
    saved: item.saved,
    mentions: item.mentions,
    credits: item.credits,
  }
}

/** First feed page for a viewer, optionally led by one reel (a shared /r/ link). */
export async function loadFeedResponse(
  db: Database,
  params: {
    profileId: string | null
    authenticated: boolean
    base: string
    cursor?: string | null
    limit?: number
    focusId?: string | null
    log: Logger
  },
): Promise<FeedResponse> {
  const { profileId, base, log } = params
  const [feed, profile, focus] = await Promise.all([
    rankFeed(db, {
      profileId,
      cursor: params.cursor ?? null,
      limit: params.limit ?? DEFAULT_FEED_LIMIT,
      log,
    }),
    profileId
      ? db.selectFrom('profile').select('topics').where('id', '=', profileId).executeTakeFirst()
      : Promise.resolve(undefined),
    params.focusId ? getFeedItem(db, { itemId: params.focusId, profileId, log }) : null,
  ])
  const items = feed.items.map((item) => toFeedDto(item, base))
  const lead = focus ? toFeedDto(focus, base) : null
  return {
    items: lead ? [lead, ...items.filter((it) => it.id !== lead.id)] : items,
    nextCursor: feed.nextCursor,
    viewer: {
      authenticated: params.authenticated,
      needsTopics: params.authenticated && (profile?.topics.length ?? 0) === 0,
    },
  }
}
