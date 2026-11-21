import type { Database, Logger } from '@reelset/core'
import type { FeedItemDto, FeedResponse } from '@/lib/api-types'
import { mediaUrl } from '@/lib/media'
import { loadCountRules, loadItemCounts } from '@/server/counts'
import { DEFAULT_FEED_LIMIT } from '@/lib/ranking/cursor'
import { getFeedItem, rankFeed, type RankedItem } from '@/lib/ranking'
import { loadFeedMinTemplate } from '@/lib/ranking/sql'

export function toFeedDto(item: RankedItem, base: string): FeedItemDto {
  return {
    id: item.id,
    title: item.title,
    tldr: item.tldr,
    topics: item.topics,
    kind: item.kind,
    canonicalUrl: item.canonicalUrl,
    score: item.score,
    publishedAt: item.publishedAt,
    videoUrl: mediaUrl(base, item.videoKey) ?? '',
    posterUrl: mediaUrl(base, item.posterKey),
    durationMs: item.durationMs,
    likeCount: item.likeCount,
    viewCount: 0,
    saveCount: 0,
    liked: item.liked,
    saved: item.saved,
    mentions: item.mentions,
    credits: item.credits,
  }
}

/** Puts the focus reel first and drops its duplicate further down. */
export function leadWith(items: FeedItemDto[], lead: FeedItemDto | null): FeedItemDto[] {
  return lead ? [lead, ...items.filter((it) => it.id !== lead.id)] : items
}

/** One reel as a feed card with its counts, or null when it is not servable. */
export async function loadFeedItemDto(
  db: Database,
  params: { itemId: string; profileId: string | null; base: string; log: Logger },
): Promise<FeedItemDto | null> {
  const item = await getFeedItem(db, params)
  if (!item) return null
  const counts = await loadItemCounts(db, [item.id])
  return {
    ...toFeedDto(item, params.base),
    viewCount: counts.get(item.id)?.views ?? 0,
    saveCount: counts.get(item.id)?.saves ?? 0,
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
    labels?: readonly string[]
    source?: string | null
    log: Logger
  },
): Promise<FeedResponse> {
  const { profileId, base, log } = params
  const minTemplate = loadFeedMinTemplate(db, log)
  const [feed, profile, focus, countRules] = await Promise.all([
    rankFeed(db, {
      profileId,
      cursor: params.cursor ?? null,
      limit: params.limit ?? DEFAULT_FEED_LIMIT,
      labels: params.labels,
      source: params.source,
      minTemplate,
      log,
    }),
    profileId
      ? db.selectFrom('profile').select('topics').where('id', '=', profileId).executeTakeFirst()
      : Promise.resolve(undefined),
    params.focusId
      ? getFeedItem(db, { itemId: params.focusId, profileId, minTemplate, log })
      : null,
    loadCountRules(db, log),
  ])
  const counts = await loadItemCounts(
    db,
    [...feed.items, ...(focus ? [focus] : [])].map((it) => it.id),
  )
  const withCounts = (item: RankedItem): FeedItemDto => ({
    ...toFeedDto(item, base),
    viewCount: counts.get(item.id)?.views ?? 0,
    saveCount: counts.get(item.id)?.saves ?? 0,
  })
  return {
    items: leadWith(feed.items.map(withCounts), focus ? withCounts(focus) : null),
    countRules,
    nextCursor: feed.nextCursor,
    viewer: {
      authenticated: params.authenticated,
      needsTopics: params.authenticated && (profile?.topics.length ?? 0) === 0,
    },
  }
}
