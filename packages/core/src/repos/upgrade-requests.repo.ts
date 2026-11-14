import type { Selectable } from 'kysely'
import type { Database } from '../db/client'
import type { CreditUpgradeRequest } from '../db/types'
import type { Logger } from '../lib/logger'
import { creditMonth } from './credits.repo'

export type UpgradeRequestRow = Selectable<CreditUpgradeRequest>
export type UpgradeRequestStatus = 'open' | 'granted' | 'dismissed'

export async function createUpgradeRequest(
  db: Database,
  input: { userId: string; email: string; message?: string | null },
): Promise<UpgradeRequestRow> {
  return db
    .insertInto('credit_upgrade_request')
    .values({ user_id: input.userId, email: input.email, message: input.message ?? null })
    .returningAll()
    .executeTakeFirstOrThrow()
}

export async function getOpenUpgradeRequest(
  db: Database,
  userId: string,
): Promise<UpgradeRequestRow | null> {
  const row = await db
    .selectFrom('credit_upgrade_request')
    .selectAll()
    .where('user_id', '=', userId)
    .where('status', '=', 'open')
    .executeTakeFirst()
  return row ?? null
}

export async function listUpgradeRequests(
  db: Database,
  opts: { status?: UpgradeRequestStatus; limit: number; offset?: number },
): Promise<UpgradeRequestRow[]> {
  let query = db.selectFrom('credit_upgrade_request').selectAll()
  if (opts.status) query = query.where('status', '=', opts.status)
  return query
    .orderBy('created_at', 'desc')
    .limit(opts.limit)
    .offset(opts.offset ?? 0)
    .execute()
}

/** Closes an open request; granting also writes the credits in the same transaction. */
export async function resolveUpgradeRequest(
  db: Database,
  id: string,
  outcome: { status: 'dismissed' } | { status: 'granted'; credits: number },
  log: Logger,
  now: Date = new Date(),
): Promise<boolean> {
  if (
    outcome.status === 'granted' &&
    (!Number.isInteger(outcome.credits) || outcome.credits <= 0)
  ) {
    throw new Error('resolveUpgradeRequest: credits must be a positive integer')
  }
  const resolved = await db.transaction().execute(async (trx) => {
    const row = await trx
      .updateTable('credit_upgrade_request')
      .set({
        status: outcome.status,
        credits_granted: outcome.status === 'granted' ? outcome.credits : null,
      })
      .where('id', '=', id)
      .where('status', '=', 'open')
      .returning(['user_id'])
      .executeTakeFirst()
    if (!row) return false
    if (outcome.status === 'granted') {
      await trx
        .insertInto('credit_ledger')
        .values({
          user_id: row.user_id,
          delta: outcome.credits,
          reason: 'grant',
          month: creditMonth(now),
        })
        .execute()
    }
    return true
  })
  log.info({ upgradeRequestId: id, outcome: outcome.status, resolved }, 'upgrade request resolved')
  return resolved
}
