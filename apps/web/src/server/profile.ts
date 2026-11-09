import { ItemStatus, RenderStatus, type Database } from '@reelset/core'
import { mediaUrl } from '@/lib/media'

export type LikedReel = { id: string; title: string; posterUrl: string | null; likedAt: string }

export async function profileSummary(db: Database, profileId: string, mediaBase: string) {
  const [profile, rows] = await Promise.all([
    db.selectFrom('profile').select('topics').where('id', '=', profileId).executeTakeFirst(),
    db
      .selectFrom('like')
      .innerJoin('item', 'item.id', 'like.item_id')
      .innerJoin('render', 'render.item_id', 'item.id')
      .select(['item.id', 'item.title', 'render.poster_key', 'like.created_at'])
      .distinctOn('item.id')
      .where('like.profile_id', '=', profileId)
      .where('item.status', '=', ItemStatus.rendered)
      .where('render.status', '=', RenderStatus.done)
      .where('render.video_key', 'is not', null)
      .orderBy('item.id')
      .orderBy('render.created_at', 'desc')
      .execute(),
  ])
  const likes: LikedReel[] = rows
    .map((r) => ({
      id: r.id,
      title: r.title,
      posterUrl: mediaUrl(mediaBase, r.poster_key),
      likedAt: new Date(r.created_at).toISOString(),
    }))
    .sort((a, b) => b.likedAt.localeCompare(a.likedAt))
    .slice(0, 60)
  return { topics: profile?.topics ?? [], likes }
}
