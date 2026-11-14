import { sql, type Selectable } from 'kysely'
import type { Database } from '../db/client'
import type { ReelRequest } from '../db/types'
import { errorFields, type Logger } from '../lib/logger'
import { refundRequest } from './credits.repo'

export type ReelRequestRow = Selectable<ReelRequest>
export type ReelRequestStatus = 'pending' | 'resolving' | 'processing' | 'done' | 'failed'
export type ReelRequestVia = 'web' | 'mcp' | 'admin'

export const REEL_REQUEST_OPEN: readonly ReelRequestStatus[] = [
  'pending',
  'resolving',
  'processing',
]

export const INSUFFICIENT_SOURCE_MESSAGE =
  'We could not read enough text from those links to write a reel. Try different or more sources.'
export const RENDER_FAILED_MESSAGE =
  'Something went wrong while making this reel. Your credits were refunded.'

export const STALE_REQUEST_MS = 6 * 60 * 60_000
export const STALE_REQUEST_MESSAGE =
  'This took too long, so we stopped it. Your credits were refunded.'

export type CreateReelRequestInput = {
  userId: string
  urls: string[]
  via: ReelRequestVia
  status?: ReelRequestStatus
  itemId?: string | null
}

export async function createReelRequest(
  db: Database,
  input: CreateReelRequestInput,
): Promise<ReelRequestRow> {
  return db
    .insertInto('reel_request')
    .values({
      user_id: input.userId,
      urls: input.urls,
      via: input.via,
      status: input.status ?? 'pending',
      item_id: input.itemId ?? null,
    })
    .returningAll()
    .executeTakeFirstOrThrow()
}

export async function getReelRequest(db: Database, id: string): Promise<ReelRequestRow | null> {
  const row = await db
    .selectFrom('reel_request')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst()
  return row ?? null
}

export async function listReelRequests(
  db: Database,
  opts: { userId?: string; limit: number; offset?: number },
): Promise<ReelRequestRow[]> {
  let query = db.selectFrom('reel_request').selectAll()
  if (opts.userId) query = query.where('user_id', '=', opts.userId)
  return query
    .orderBy('created_at', 'desc')
    .limit(opts.limit)
    .offset(opts.offset ?? 0)
    .execute()
}

export async function countOpenReelRequests(db: Database, userId: string): Promise<number> {
  const row = await db
    .selectFrom('reel_request')
    .select(sql<string>`count(*)`.as('n'))
    .where('user_id', '=', userId)
    .where('status', 'in', [...REEL_REQUEST_OPEN])
    .executeTakeFirstOrThrow()
  return Number(row.n)
}

export async function countReelRequestsSince(
  db: Database,
  userId: string,
  since: Date,
): Promise<number> {
  const row = await db
    .selectFrom('reel_request')
    .select(sql<string>`count(*)`.as('n'))
    .where('user_id', '=', userId)
    .where('created_at', '>=', since)
    .executeTakeFirstOrThrow()
  return Number(row.n)
}

/** Atomically moves the oldest pending requests to resolving and returns them. */
export async function claimPendingReelRequests(
  db: Database,
  limit: number,
): Promise<ReelRequestRow[]> {
  const result = await sql<ReelRequestRow>`
    update reel_request set status = 'resolving', updated_at = now()
    where id in (
      select id from reel_request where status = 'pending'
      order by created_at asc limit ${limit} for update skip locked
    )
    returning *`.execute(db)
  return result.rows
}

export type ReelRequestResult = {
  status: ReelRequestStatus
  itemId?: string | null
  error?: string | null
}

/** Sets the outcome; `from` guards against a concurrent state change. Returns whether a row changed. */
export async function setReelRequestResult(
  db: Database,
  id: string,
  result: ReelRequestResult,
  from?: readonly ReelRequestStatus[],
): Promise<boolean> {
  let query = db
    .updateTable('reel_request')
    .set({
      status: result.status,
      ...(result.itemId !== undefined ? { item_id: result.itemId } : {}),
      error: result.error ?? null,
      updated_at: sql`now()`,
    })
    .where('id', '=', id)
  if (from) query = query.where('status', 'in', [...from])
  const res = await query.executeTakeFirst()
  return Number(res.numUpdatedRows) > 0
}

export type SettleResult = { done: number; failed: number; refunded: number }

/** Moves processing requests to done or failed from their item; failures are refunded once. */
export async function settleReelRequests(
  db: Database,
  log: Logger,
  now: Date = new Date(),
): Promise<SettleResult> {
  const l = log.child({ mod: 'settle-requests' })
  const rows = await db
    .selectFrom('reel_request as r')
    .leftJoin('item as i', 'i.id', 'r.item_id')
    .select([
      'r.id as id',
      'r.item_id as item_id',
      'i.status as item_status',
      sql<boolean>`exists (
        select 1 from render where render.item_id = r.item_id and render.status = 'done'
      )`.as('has_done_render'),
    ])
    .where('r.status', '=', 'processing')
    .limit(200)
    .execute()

  const out: SettleResult = { done: 0, failed: 0, refunded: 0 }

  const stale = await db
    .selectFrom('reel_request')
    .select('id')
    .where('status', 'in', [...REEL_REQUEST_OPEN])
    .where('created_at', '<', new Date(now.getTime() - STALE_REQUEST_MS))
    .limit(200)
    .execute()
  for (const row of stale) {
    const rl = l.child({ requestId: row.id })
    try {
      const changed = await setReelRequestResult(
        db,
        row.id,
        { status: 'failed', error: STALE_REQUEST_MESSAGE },
        [...REEL_REQUEST_OPEN],
      )
      if (!changed) continue
      out.failed += 1
      if (await refundRequest(db, row.id, rl, now)) out.refunded += 1
      rl.warn('stale reel request failed')
    } catch (err) {
      rl.error(errorFields(err), 'stale request sweep failed')
    }
  }

  const unrefunded = await db
    .selectFrom('reel_request')
    .select('id')
    .where('status', '=', 'failed')
    .where('refunded', '=', false)
    .where('credits_charged', '>', 0)
    .limit(200)
    .execute()
  for (const row of unrefunded) {
    const rl = l.child({ requestId: row.id })
    try {
      if (await refundRequest(db, row.id, rl, now)) out.refunded += 1
    } catch (err) {
      rl.error(errorFields(err), 'refund sweep failed')
    }
  }

  for (const row of rows) {
    const rl = l.child({ requestId: row.id, itemId: row.item_id })
    try {
      let error: string | null = null
      let target: 'done' | 'failed' | null = null
      if (row.item_id === null || row.item_status === null) {
        target = 'failed'
        error = RENDER_FAILED_MESSAGE
      } else if (row.item_status === 'rendered' && row.has_done_render) {
        target = 'done'
      } else if (row.item_status === 'insufficient_source') {
        target = 'failed'
        error = INSUFFICIENT_SOURCE_MESSAGE
      } else if (row.item_status === 'failed') {
        target = 'failed'
        error = RENDER_FAILED_MESSAGE
      }
      if (!target) continue
      const changed = await setReelRequestResult(db, row.id, { status: target, error }, [
        'processing',
      ])
      if (!changed) continue
      if (target === 'done') {
        out.done += 1
        rl.info('reel request done')
      } else {
        out.failed += 1
        if (await refundRequest(db, row.id, rl, now)) out.refunded += 1
        rl.info({ error }, 'reel request failed')
      }
    } catch (err) {
      rl.error(errorFields(err), 'settle failed for request')
    }
  }
  return out
}
