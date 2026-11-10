import { errorFields } from '@reelset/core'
import { cookies } from 'next/headers'
import type { FeedItemDto, FeedResponse } from '@/lib/api-types'
import { mediaUrl } from '@/lib/media'
import { DEFAULT_FEED_LIMIT } from '@/lib/ranking/cursor'
import { getFeedItem, rankFeed, type RankedItem } from '@/lib/ranking'
import { getOptionalUser } from '@/server/auth'
import { getDb } from '@/server/db'
import { mediaBaseUrl } from '@/server/env'
import { routeLog } from '@/server/logger'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const querySchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().optional(),
  item: z.guid().optional(),
})

function toDto(item: RankedItem, base: string): FeedItemDto {
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
    liked: item.liked,
    saved: item.saved,
    mentions: item.mentions,
    credits: item.credits,
  }
}

export async function GET(request: Request) {
  const log = routeLog('api/feed')
  const params = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams))
  if (!params.success) return Response.json({ error: 'invalid_query' }, { status: 400 })

  try {
    await cookies()
    const db = getDb()
    const base = mediaBaseUrl()
    const user = await getOptionalUser()
    const profileId = user?.id ?? null

    if (params.data.item) {
      const item = await getFeedItem(db, { itemId: params.data.item, profileId, log })
      if (!item) return Response.json({ error: 'not_found' }, { status: 404 })
      return Response.json(
        { item: toDto(item, base) },
        { headers: { 'cache-control': 'no-store' } },
      )
    }

    const [feed, profile] = await Promise.all([
      rankFeed(db, {
        profileId,
        cursor: params.data.cursor ?? null,
        limit: params.data.limit ?? DEFAULT_FEED_LIMIT,
        log,
      }),
      profileId
        ? db.selectFrom('profile').select('topics').where('id', '=', profileId).executeTakeFirst()
        : Promise.resolve(undefined),
    ])

    const body: FeedResponse = {
      items: feed.items.map((item) => toDto(item, base)),
      nextCursor: feed.nextCursor,
      viewer: {
        authenticated: user !== null,
        needsTopics: user !== null && (profile?.topics.length ?? 0) === 0,
      },
    }
    return Response.json(body, { headers: { 'cache-control': 'no-store' } })
  } catch (err) {
    log.error(errorFields(err), 'feed request failed')
    return Response.json({ error: 'internal' }, { status: 500 })
  }
}
