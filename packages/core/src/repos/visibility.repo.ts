import { sql } from 'kysely'
import type { Database } from '../db/client'
import { InstagramPostStatus } from '../db/enums'
import { HIDDEN_INSTAGRAM_ERROR, type HiddenReason } from '../domain/visibility'
import type { Logger } from '../lib/logger'

export type VisibilityChange = { changed: number; cancelledPosts: number }

/** Hides public items from every surface and fails their queued Instagram posts, in one transaction. */
export async function hideItems(
  db: Database,
  input: { itemIds: readonly string[]; reason: HiddenReason },
  log: Logger,
): Promise<VisibilityChange> {
  if (input.itemIds.length === 0) return { changed: 0, cancelledPosts: 0 }
  const result = await db.transaction().execute(async (trx) => {
    const hidden = await trx
      .updateTable('item')
      .set({
        visibility: 'hidden',
        hidden_reason: input.reason,
        hidden_at: sql`now()`,
        updated_at: sql`now()`,
      })
      .where('id', 'in', [...input.itemIds])
      .where('visibility', '=', 'public')
      .returning('id')
      .execute()
    if (hidden.length === 0) return { changed: 0, cancelledPosts: 0 }
    const cancelled = await trx
      .updateTable('instagram_post')
      .set({
        status: InstagramPostStatus.failed,
        error: HIDDEN_INSTAGRAM_ERROR,
        updated_at: sql`now()`,
      })
      .where(
        'item_id',
        'in',
        hidden.map((row) => row.id),
      )
      .where('status', '=', InstagramPostStatus.queued)
      .returning('id')
      .execute()
    return { changed: hidden.length, cancelledPosts: cancelled.length }
  })
  log.info({ requested: input.itemIds.length, reason: input.reason, ...result }, 'items hidden')
  return result
}

/** Returns hidden items to where they were: public, or private again for a user's requested reel. */
export async function unhideItems(
  db: Database,
  input: { itemIds: readonly string[] },
  log: Logger,
): Promise<number> {
  if (input.itemIds.length === 0) return 0
  const rows = await db
    .updateTable('item')
    .set({
      visibility: sql`case when owner_id is null then 'public' else 'private' end`,
      hidden_reason: null,
      hidden_at: null,
      updated_at: sql`now()`,
    })
    .where('id', 'in', [...input.itemIds])
    .where('visibility', '=', 'hidden')
    .returning('id')
    .execute()
  log.info({ requested: input.itemIds.length, changed: rows.length }, 'items unhidden')
  return rows.length
}
