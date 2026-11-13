import { SETTINGS, getSetting, type Database, type Logger } from '@reelset/core'
import type { CountRules } from '@/lib/counts'

export async function loadCountRules(db: Database, log: Logger): Promise<CountRules> {
  const [sv, mv, sl, ml, ss, ms] = await Promise.all([
    getSetting(db, SETTINGS.showViewCount, log),
    getSetting(db, SETTINGS.viewCountThreshold, log),
    getSetting(db, SETTINGS.showLikeCount, log),
    getSetting(db, SETTINGS.likeCountThreshold, log),
    getSetting(db, SETTINGS.showSaveCount, log),
    getSetting(db, SETTINGS.saveCountThreshold, log),
  ])
  return {
    views: { show: sv, min: mv },
    likes: { show: sl, min: ml },
    saves: { show: ss, min: ms },
  }
}

export async function loadItemCounts(
  db: Database,
  itemIds: string[],
): Promise<Map<string, { views: number; saves: number }>> {
  if (itemIds.length === 0) return new Map()
  const rows = await db
    .selectFrom('item')
    .select([
      'item.id',
      'item.view_count',
      (eb) =>
        eb
          .selectFrom('save')
          .select(eb.fn.countAll<string>().as('n'))
          .whereRef('save.item_id', '=', 'item.id')
          .as('save_count'),
    ])
    .where('item.id', 'in', itemIds)
    .execute()
  return new Map(rows.map((r) => [r.id, { views: r.view_count, saves: Number(r.save_count ?? 0) }]))
}
