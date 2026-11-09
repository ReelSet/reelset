import { elapsedMs, errorFields, type Database, type Logger } from '@reelset/core'
import { clampLimit, decodeCursor, encodeCursor } from './cursor'
import { rankCandidates } from './scoring'
import {
  hydrateQuery,
  loadCandidates,
  loadFeedMinTemplate,
  loadProfileSignals,
  type FeedRow,
} from './sql'

export type RankedItem = {
  id: string
  title: string
  tldr: string | null
  topics: string[]
  kind: string
  canonicalUrl: string
  score: number
  publishedAt: string
  videoKey: string
  posterKey: string | null
  durationMs: number | null
  likeCount: number
  liked: boolean
  mentions: { source: string; score: number | null; url: string }[]
}

export type RankFeedParams = {
  profileId: string | null
  cursor: string | null
  limit: number
  log?: Logger
}

export type RankedFeed = { items: RankedItem[]; nextCursor: string | null }

// Row filter backing the SQL: a row without a video key can never be shown in the feed.
export function toRankedItem(row: FeedRow): RankedItem | null {
  if (!row.video_key) return null
  return {
    id: row.id,
    title: row.title,
    tldr: row.tldr,
    topics: row.topics,
    kind: row.kind,
    canonicalUrl: row.canonical_url,
    score: row.score,
    publishedAt: new Date(row.published_at).toISOString(),
    videoKey: row.video_key,
    posterKey: row.poster_key,
    durationMs: row.video_duration_ms,
    likeCount: Number(row.like_count ?? 0),
    liked: Boolean(row.liked),
    mentions: row.mentions,
  }
}

export function orderRows(rows: FeedRow[], ids: string[]): FeedRow[] {
  const byId = new Map(rows.map((row) => [row.id, row]))
  return ids.flatMap((id) => {
    const row = byId.get(id)
    return row ? [row] : []
  })
}

export async function rankFeed(db: Database, params: RankFeedParams): Promise<RankedFeed> {
  const started = performance.now()
  const limit = clampLimit(params.limit)
  const log = params.log?.child({ fn: 'rankFeed', profileId: params.profileId })
  const cursor = decodeCursor(params.cursor)
  if (params.cursor && !cursor) log?.warn('invalid feed cursor ignored, serving first page')

  const asOf = cursor?.asOf ?? new Date().toISOString()
  const offset = cursor?.offset ?? 0

  try {
    const profile = params.profileId
      ? await loadProfileSignals(db, params.profileId)
      : { signalCount: 0, topics: [] }
    const minTemplate = await loadFeedMinTemplate(db, log)
    const candidates = await loadCandidates(db, { profileId: params.profileId, asOf, minTemplate })
    const ranked = rankCandidates(candidates, {
      asOf: new Date(asOf),
      signalCount: profile.signalCount,
      profileTopics: profile.topics,
    })

    const pageIds = ranked.slice(offset, offset + limit)
    const nextCursor =
      offset + limit < ranked.length ? encodeCursor({ asOf, offset: offset + limit }) : null

    const rows = pageIds.length
      ? await hydrateQuery(db, {
          profileId: params.profileId,
          itemIds: pageIds,
          minTemplate,
        }).execute()
      : []
    const items = orderRows(rows, pageIds).flatMap((row) => {
      const item = toRankedItem(row)
      if (!item) log?.warn({ itemId: row.id }, 'feed row without video key dropped')
      return item ? [item] : []
    })
    log?.info(
      {
        count: items.length,
        offset,
        pool: candidates.length,
        minTemplate,
        personalized: profile.signalCount,
        hasMore: nextCursor !== null,
        durationMs: elapsedMs(started),
      },
      'feed page ranked',
    )
    return { items, nextCursor }
  } catch (err) {
    log?.error(errorFields(err), 'feed query failed')
    throw err
  }
}

export async function getFeedItem(
  db: Database,
  params: { itemId: string; profileId: string | null; log?: Logger },
): Promise<RankedItem | null> {
  const log = params.log?.child({ fn: 'getFeedItem', itemId: params.itemId })
  const rows = await hydrateQuery(db, {
    profileId: params.profileId,
    itemIds: [params.itemId],
    minTemplate: await loadFeedMinTemplate(db, log),
  }).execute()
  const row = rows[0]
  const item = row ? toRankedItem(row) : null
  log?.info({ found: item !== null }, 'single feed item lookup')
  return item
}
