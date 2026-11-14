import { sql, type Selectable } from 'kysely'
import type { Database } from '../db/client'
import type { ReelRequest } from '../db/types'
import type { Logger } from '../lib/logger'

/** UTC calendar month key, e.g. 2026-11. */
export function creditMonth(now: Date): string {
  return now.toISOString().slice(0, 7)
}

/** First instant of the next UTC month: when unused monthly credits reset. */
export function creditResetsAt(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
}

export function balanceFrom(monthlyFree: number, monthDeltaSum: number): number {
  return monthlyFree + monthDeltaSum
}

type Queryable = Pick<Database, 'selectFrom' | 'insertInto' | 'updateTable'>

async function monthSum(db: Queryable, userId: string, month: string): Promise<number> {
  const row = await db
    .selectFrom('credit_ledger')
    .select(sql<string>`coalesce(sum(delta), 0)`.as('total'))
    .where('user_id', '=', userId)
    .where('month', '=', month)
    .executeTakeFirstOrThrow()
  return Number(row.total)
}

/** Free credits for the month plus every ledger delta (spends, refunds, grants) in that month. */
export async function creditBalance(
  db: Database,
  userId: string,
  monthlyFree: number,
  now: Date = new Date(),
): Promise<number> {
  return balanceFrom(monthlyFree, await monthSum(db, userId, creditMonth(now)))
}

export type SpendInput = {
  userId: string
  cost: number
  monthlyFree: number
  requestId?: string | null
  now?: Date
}
export type SpendResult = { ok: true; balance: number } | { ok: false; balance: number }

/** Debits `cost` only if the balance covers it; serialized per user by an advisory lock. */
export async function spendCredits(
  db: Database,
  input: SpendInput,
  log: Logger,
): Promise<SpendResult> {
  const now = input.now ?? new Date()
  const month = creditMonth(now)
  const l = log.child({ mod: 'credits', userId: input.userId, requestId: input.requestId })
  const result = await db.transaction().execute(async (trx) => {
    await sql`select pg_advisory_xact_lock(hashtextextended(${input.userId}::text, 0))`.execute(trx)
    const balance = balanceFrom(input.monthlyFree, await monthSum(trx, input.userId, month))
    if (balance < input.cost) return { ok: false, balance } satisfies SpendResult
    await trx
      .insertInto('credit_ledger')
      .values({
        user_id: input.userId,
        delta: -input.cost,
        reason: 'reel',
        request_id: input.requestId ?? null,
        month,
      })
      .execute()
    if (input.requestId) {
      await trx
        .updateTable('reel_request')
        .set({ credits_charged: input.cost, updated_at: sql`now()` })
        .where('id', '=', input.requestId)
        .execute()
    }
    return { ok: true, balance: balance - input.cost } satisfies SpendResult
  })
  if (!result.ok) l.info({ balance: result.balance, cost: input.cost }, 'spend refused')
  else l.info({ cost: input.cost, balance: result.balance }, 'credits spent')
  return result
}

/** Returns the credits of a request once, into the current month;  false when nothing was charged or already refunded. */
export type ChargedRequestInput = {
  userId: string
  urls: string[]
  via: 'web' | 'mcp' | 'admin'
  cost: number
  monthlyFree: number
  now?: Date
}
export type ChargedRequestResult =
  { ok: true; request: Selectable<ReelRequest>; balance: number } | { ok: false; balance: number }

/** Checks the balance, creates the pending request and debits it in one locked transaction. */
export async function createChargedReelRequest(
  db: Database,
  input: ChargedRequestInput,
  log: Logger,
): Promise<ChargedRequestResult> {
  const now = input.now ?? new Date()
  const month = creditMonth(now)
  const l = log.child({ mod: 'credits', userId: input.userId })
  const result = await db.transaction().execute(async (trx) => {
    await sql`select pg_advisory_xact_lock(hashtextextended(${input.userId}::text, 0))`.execute(trx)
    const balance = balanceFrom(input.monthlyFree, await monthSum(trx, input.userId, month))
    if (balance < input.cost) return { ok: false, balance } satisfies ChargedRequestResult
    const request = await trx
      .insertInto('reel_request')
      .values({
        user_id: input.userId,
        urls: input.urls,
        via: input.via,
        status: 'pending',
        credits_charged: input.cost,
      })
      .returningAll()
      .executeTakeFirstOrThrow()
    await trx
      .insertInto('credit_ledger')
      .values({
        user_id: input.userId,
        delta: -input.cost,
        reason: 'reel',
        request_id: request.id,
        month,
      })
      .execute()
    return { ok: true, request, balance: balance - input.cost } satisfies ChargedRequestResult
  })
  if (!result.ok) l.info({ balance: result.balance, cost: input.cost }, 'charged request refused')
  else l.info({ requestId: result.request.id, cost: input.cost }, 'charged request created')
  return result
}

export async function refundRequest(
  db: Database,
  requestId: string,
  log: Logger,
  now: Date = new Date(),
): Promise<boolean> {
  const l = log.child({ mod: 'credits', requestId })
  const refunded = await db.transaction().execute(async (trx) => {
    const row = await trx
      .updateTable('reel_request')
      .set({ refunded: true, updated_at: sql`now()` })
      .where('id', '=', requestId)
      .where('refunded', '=', false)
      .where('credits_charged', '>', 0)
      .returning(['user_id', 'credits_charged'])
      .executeTakeFirst()
    if (!row) return null
    await trx
      .insertInto('credit_ledger')
      .values({
        user_id: row.user_id,
        delta: row.credits_charged,
        reason: 'refund',
        request_id: requestId,
        month: creditMonth(now),
      })
      .execute()
    return row
  })
  if (refunded) l.info({ credits: refunded.credits_charged }, 'credits refunded')
  return refunded !== null
}

export async function grantCredits(
  db: Database,
  input: { userId: string; credits: number; now?: Date },
  log: Logger,
): Promise<void> {
  if (!Number.isInteger(input.credits) || input.credits <= 0) {
    throw new Error('grantCredits: credits must be a positive integer')
  }
  await db
    .insertInto('credit_ledger')
    .values({
      user_id: input.userId,
      delta: input.credits,
      reason: 'grant',
      month: creditMonth(input.now ?? new Date()),
    })
    .execute()
  log.info({ userId: input.userId, credits: input.credits }, 'credits granted')
}
