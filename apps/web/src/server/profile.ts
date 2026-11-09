import { ItemStatus, RenderStatus, type Database } from '@reelset/core'
import { enabledSources, type ProfileSource } from '@/lib/preferences'
import { mediaUrl } from '@/lib/media'

export type PosterReel = { id: string; title: string; posterUrl: string | null; at: string }

export const LIBRARY_LIMIT = 60

function reelsFrom(db: Database, table: 'like' | 'save', profileId: string) {
  return db
    .selectFrom(table)
    .innerJoin('item', 'item.id', `${table}.item_id`)
    .innerJoinLateral(
      (eb) =>
        eb
          .selectFrom('render')
          .select('render.poster_key')
          .whereRef('render.item_id', '=', 'item.id')
          .where('render.status', '=', RenderStatus.done)
          .where('render.video_key', 'is not', null)
          .orderBy('render.created_at', 'desc')
          .limit(1)
          .as('r'),
      (join) => join.onTrue(),
    )
    .select(['item.id', 'item.title', 'r.poster_key', `${table}.created_at as at`])
    .where(`${table}.profile_id`, '=', profileId)
    .where('item.status', '=', ItemStatus.rendered)
    .orderBy(`${table}.created_at`, 'desc')
    .limit(LIBRARY_LIMIT)
}

export function libraryQuery(db: Database, table: 'like' | 'save', profileId: string) {
  return reelsFrom(db, table, profileId)
}

export async function profileSummary(db: Database, profileId: string, mediaBase: string) {
  const toReel = (r: { id: string; title: string; poster_key: string | null; at: Date | string }) =>
    ({
      id: r.id,
      title: r.title,
      posterUrl: mediaUrl(mediaBase, r.poster_key),
      at: new Date(r.at).toISOString(),
    }) satisfies PosterReel
  const [profile, liked, saved] = await Promise.all([
    db
      .selectFrom('profile')
      .select(['topics', 'sources', 'created_at'])
      .where('id', '=', profileId)
      .executeTakeFirst(),
    libraryQuery(db, 'like', profileId).execute(),
    libraryQuery(db, 'save', profileId).execute(),
  ])
  return {
    topics: profile?.topics ?? [],
    sources: enabledSources(profile?.sources ?? []) as ProfileSource[],
    memberSince: profile ? new Date(profile.created_at).toISOString() : null,
    liked: liked.map(toReel),
    saved: saved.map(toReel),
  }
}
