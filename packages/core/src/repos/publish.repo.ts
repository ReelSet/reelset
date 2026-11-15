import { sql } from 'kysely'
import type { Selectable } from 'kysely'
import type { Database } from '../db/client'
import type { Item } from '../db/types'
import type { Logger } from '../lib/logger'

export type PublishRefusal = 'not_found' | 'not_ready' | 'already_submitted' | 'not_submitted'
export type PublishChange = { ok: true } | { ok: false; reason: PublishRefusal }
export type PublishDecision = 'approve' | 'reject'

type OwnedItem = Pick<Selectable<Item>, 'status' | 'visibility' | 'publish_review' | 'owner_id'> & {
  has_video: boolean
}

async function loadOwnedItem(
  db: Database,
  itemId: string,
  ownerId: string,
): Promise<OwnedItem | null> {
  const row = await db
    .selectFrom('item')
    .select([
      'status',
      'visibility',
      'publish_review',
      'owner_id',
      sql<boolean>`exists (
        select 1 from render r
        where r.item_id = item.id and r.status = 'done' and r.video_key is not null
      )`.as('has_video'),
    ])
    .where('id', '=', itemId)
    .where('owner_id', '=', ownerId)
    .executeTakeFirst()
  return row ?? null
}

function refusalFor(item: OwnedItem | null): PublishRefusal {
  if (!item) return 'not_found'
  if (item.visibility === 'public' || item.publish_review === 'pending') return 'already_submitted'
  return 'not_ready'
}

/** Owner asks for a finished private reel to be reviewed; a rejected one can be resubmitted. */
export async function requestPublish(
  db: Database,
  input: { itemId: string; ownerId: string },
  log: Logger,
): Promise<PublishChange> {
  const updated = await db
    .updateTable('item')
    .set({
      publish_review: 'pending',
      publish_requested_at: sql`now()`,
      publish_reviewed_at: null,
      publish_note: null,
    })
    .where('id', '=', input.itemId)
    .where('owner_id', '=', input.ownerId)
    .where('visibility', '=', 'private')
    .where('status', '=', 'rendered')
    .where((eb) =>
      eb.or([
        eb('publish_review', 'is', null),
        eb('publish_review', 'in', ['rejected', 'approved']),
      ]),
    )
    .where(
      sql<boolean>`exists (
        select 1 from render r
        where r.item_id = item.id and r.status = 'done' and r.video_key is not null
      )`,
    )
    .returning('id')
    .executeTakeFirst()
  if (updated) {
    log.info({ itemId: input.itemId, ownerId: input.ownerId }, 'publish requested')
    return { ok: true }
  }
  const reason = refusalFor(await loadOwnedItem(db, input.itemId, input.ownerId))
  log.info({ itemId: input.itemId, reason }, 'publish request refused')
  return { ok: false, reason }
}

/** Owner takes a reel out of review or out of the public feed; it goes back to private. */
export async function withdrawPublish(
  db: Database,
  input: { itemId: string; ownerId: string },
  log: Logger,
): Promise<PublishChange> {
  const updated = await db
    .updateTable('item')
    .set({
      visibility: 'private',
      publish_review: null,
      publish_requested_at: null,
      publish_reviewed_at: null,
      publish_note: null,
      updated_at: sql`now()`,
    })
    .where('id', '=', input.itemId)
    .where('owner_id', '=', input.ownerId)
    .where((eb) =>
      eb.or([
        eb('visibility', '=', 'public'),
        eb.and([eb('visibility', '=', 'private'), eb('publish_review', '=', 'pending')]),
      ]),
    )
    .returning('id')
    .executeTakeFirst()
  if (updated) {
    log.info({ itemId: input.itemId, ownerId: input.ownerId }, 'publish withdrawn')
    return { ok: true }
  }
  const item = await loadOwnedItem(db, input.itemId, input.ownerId)
  return { ok: false, reason: item ? 'not_submitted' : 'not_found' }
}

/** Admin decision on a pending submission; approving makes the reel public in the same statement. */
export async function reviewPublish(
  db: Database,
  input: { itemId: string; decision: PublishDecision; note: string | null },
  log: Logger,
): Promise<boolean> {
  const approve = input.decision === 'approve'
  const updated = await db
    .updateTable('item')
    .set({
      publish_review: approve ? 'approved' : 'rejected',
      publish_reviewed_at: sql`now()`,
      publish_note: input.note,
      ...(approve ? { visibility: 'public', updated_at: sql`now()` } : {}),
    })
    .where('id', '=', input.itemId)
    .where('publish_review', '=', 'pending')
    .where('visibility', '=', 'private')
    .returning('id')
    .executeTakeFirst()
  log.info(
    { itemId: input.itemId, decision: input.decision, applied: !!updated },
    'publish reviewed',
  )
  return !!updated
}

export async function countPendingPublish(db: Database): Promise<number> {
  const row = await db
    .selectFrom('item')
    .select(db.fn.countAll<string>().as('n'))
    .where('publish_review', '=', 'pending')
    .where('visibility', '=', 'private')
    .executeTakeFirst()
  return Number(row?.n ?? 0)
}
