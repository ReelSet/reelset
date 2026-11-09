import { ItemStatus, RenderStatus, errorFields, type Database, type Logger } from '@reelset/core'
import { sql } from 'kysely'
import type { CitationDto, RelatedReelDto } from '@/lib/api-types'
import { pickRelatedReels, type ReelRow } from '@/lib/ask/related-reels'
import { mediaUrl } from '@/lib/media'
import { loadFeedMinTemplate } from '@/lib/ranking/sql'

export function chunkItemsQuery(db: Database, chunkIds: string[]) {
  return db.selectFrom('evidence_chunk').select(['id', 'item_id']).where('id', 'in', chunkIds)
}

export function servedReelsQuery(db: Database, itemIds: string[], minTemplate: number) {
  return db
    .selectFrom('item')
    .innerJoinLateral(
      (eb) =>
        eb
          .selectFrom('render')
          .select('render.poster_key')
          .whereRef('render.item_id', '=', 'item.id')
          .where('render.status', '=', RenderStatus.done)
          .where('render.video_key', 'is not', null)
          .where(sql<boolean>`coalesce(render.template_version, 0) >= ${minTemplate}`)
          .orderBy(sql`coalesce(render.template_version, 0) desc`)
          .orderBy(sql`render.finished_at desc nulls last`)
          .limit(1)
          .as('r'),
      (join) => join.onTrue(),
    )
    .where('item.status', '=', ItemStatus.rendered)
    .where('item.id', 'in', itemIds)
    .select((eb) => [
      'item.id',
      'item.title',
      'r.poster_key',
      eb
        .selectFrom('mention')
        .select(sql<string>`mention.source::text`.as('source'))
        .whereRef('mention.item_id', '=', 'item.id')
        .orderBy(sql`mention.score desc nulls last`)
        .limit(1)
        .as('source'),
    ])
}

export async function resolveRelatedReels(
  db: Database,
  citations: readonly Pick<CitationDto, 'chunkId'>[],
  mediaBase: string,
  log?: Logger,
): Promise<RelatedReelDto[]> {
  const chunkIds = [...new Set(citations.map((c) => c.chunkId))]
  if (chunkIds.length === 0) return []
  try {
    const chunks = await chunkItemsQuery(db, chunkIds).execute()
    const chunkItems = new Map(chunks.map((c) => [c.id, c.item_id]))
    const itemIds = [...new Set(chunkItems.values())]
    if (itemIds.length === 0) return []
    const minTemplate = await loadFeedMinTemplate(db, log)
    const rows = await servedReelsQuery(db, itemIds, minTemplate).execute()
    const reels = new Map<string, ReelRow>(rows.map((r) => [r.id, r]))
    const result = pickRelatedReels(citations, chunkItems, reels, (key) => mediaUrl(mediaBase, key))
    log?.info({ citations: chunkIds.length, reels: result.length }, 'related reels resolved')
    return result
  } catch (err) {
    log?.error(errorFields(err), 'related reels failed')
    return []
  }
}
