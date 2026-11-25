import { errorFields, SERVED_RENDER_ORDER_SQL, type Database } from '@reelset/core'
import { sql } from 'kysely'
import { unstable_cache } from 'next/cache'
import { mediaUrl } from '@/lib/media'
import {
  pickShowcase,
  SHOWCASE_COUNT,
  type ShowcaseCandidate,
  type ShowcaseReel,
} from '@/lib/showcase'
import { getDb } from './db'
import { mediaBaseUrl } from './env'
import { log } from './logger'

const REVALIDATE_SECONDS = 3600
const RECENT_DAYS = 45
const PER_SOURCE_LIMIT = 3

/** Recent public rendered reels with a finished video, best mention score per source; the source is the earliest mention's. */
export async function showcaseReels(db: Database, limit = SHOWCASE_COUNT): Promise<ShowcaseReel[]> {
  const { rows } = await sql<ShowcaseCandidate>`
    select id, title, score, source, video_key, poster_key, thumb_key, video_duration_ms from (
      select i.id, i.title, src.source, served.video_key, served.poster_key, served.thumb_key, served.video_duration_ms,
        coalesce(src.top_score, 0)::float8 as score,
        row_number() over (
          partition by src.source order by coalesce(src.top_score, 0) desc, i.published_at desc
        ) as rank_in_source
      from item i
      join lateral (
        select r.video_key, r.poster_key, r.thumb_key, r.video_duration_ms from render r
        where r.item_id = i.id and r.status = 'done' and r.video_key is not null
        order by ${sql.raw(SERVED_RENDER_ORDER_SQL)} limit 1
      ) served on true
      join lateral (
        select m.source::text as source, (select max(score) from mention where item_id = i.id) as top_score
        from mention m where m.item_id = i.id order by m.published_at asc limit 1
      ) src on true
      where i.status = 'rendered' and i.visibility = 'public'
        and i.published_at > now() - make_interval(days => ${RECENT_DAYS})
    ) ranked
    where rank_in_source <= ${PER_SOURCE_LIMIT}
  `.execute(db)
  const base = mediaBaseUrl()
  return pickShowcase(rows, (key) => mediaUrl(base, key) ?? key, limit)
}

const cached = unstable_cache(() => showcaseReels(getDb()), ['showcase-reels'], {
  revalidate: REVALIDATE_SECONDS,
})

/** Showcase reels for the landing page, cached for an hour; [] on any failure so the row hides. */
export async function getShowcaseReels(): Promise<ShowcaseReel[]> {
  try {
    return await cached()
  } catch (err) {
    log.error(errorFields(err), 'showcase reels failed')
    return []
  }
}
