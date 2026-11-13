import { ItemStatus, errorFields, type Database, type Logger } from '@reelset/core'
import { sql } from 'kysely'
import { viewAllowance } from '@/lib/views'

export type RecordViewsResult = { recorded: number; counted: string[]; limited: boolean }

/**
 * Stores at most one view per (reel, viewer, UTC day) and bumps item.view_count only for rows
 * that were new, so a replayed beacon or scrolling back never inflates the counter.
 */
export async function recordViews(
  db: Database,
  input: { viewerKey: string; itemIds: string[] },
  log: Logger,
): Promise<RecordViewsResult> {
  const l = log.child({ fn: 'recordViews' })
  try {
    const recent = await db
      .selectFrom('item_view')
      .select(db.fn.countAll<string>().as('n'))
      .where('viewer_key', '=', input.viewerKey)
      .where('created_at', '>', sql<Date>`now() - interval '1 hour'`)
      .executeTakeFirstOrThrow()
    const allowed = viewAllowance(Number(recent.n), input.itemIds.length)
    if (allowed === 0) {
      l.warn({ requested: input.itemIds.length }, 'view allowance exhausted')
      return { recorded: 0, counted: [], limited: true }
    }

    const itemIds = input.itemIds.slice(0, allowed)
    const visible = await db
      .selectFrom('item')
      .select('id')
      .where('id', 'in', itemIds)
      .where('status', '=', ItemStatus.rendered)
      .execute()
    if (visible.length === 0) return { recorded: 0, counted: [], limited: false }

    const inserted = await db
      .insertInto('item_view')
      .values(
        visible.map((v) => ({
          item_id: v.id,
          viewer_key: input.viewerKey,
          day: sql<Date>`(now() at time zone 'utc')::date`,
        })),
      )
      .onConflict((oc) => oc.columns(['item_id', 'viewer_key', 'day']).doNothing())
      .returning('item_id')
      .execute()
    const counted = inserted.map((r) => r.item_id)
    if (counted.length > 0) {
      await db
        .updateTable('item')
        .set({ view_count: sql<number>`view_count + 1` })
        .where('id', 'in', counted)
        .execute()
    }
    l.info({ requested: input.itemIds.length, counted: counted.length }, 'views recorded')
    return { recorded: counted.length, counted, limited: allowed < input.itemIds.length }
  } catch (err) {
    l.error(errorFields(err), 'recording views failed')
    throw err
  }
}
