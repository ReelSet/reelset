import { SETTINGS, parseSetting, type Database, type Logger, type SettingDef } from '@reelset/core'
import type { CountRules } from '@/lib/counts'

const COUNT_SETTINGS = [
  SETTINGS.showViewCount,
  SETTINGS.viewCountThreshold,
  SETTINGS.showLikeCount,
  SETTINGS.likeCountThreshold,
  SETTINGS.showSaveCount,
  SETTINGS.saveCountThreshold,
] as const

/** All six count settings in one round trip. */
export async function loadCountRules(db: Database, log: Logger): Promise<CountRules> {
  const rows = await db
    .selectFrom('app_setting')
    .select(['key', 'value'])
    .where(
      'key',
      'in',
      COUNT_SETTINGS.map((s) => s.key),
    )
    .execute()
  const raw = new Map(rows.map((r) => [r.key, r.value as unknown]))
  const get = <T>(setting: SettingDef<T>) => parseSetting(setting, raw.get(setting.key), log)
  return {
    views: { show: get(SETTINGS.showViewCount), min: get(SETTINGS.viewCountThreshold) },
    likes: { show: get(SETTINGS.showLikeCount), min: get(SETTINGS.likeCountThreshold) },
    saves: { show: get(SETTINGS.showSaveCount), min: get(SETTINGS.saveCountThreshold) },
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
