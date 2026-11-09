import { sql } from 'kysely'
import type { Database } from '../db/client'
import type { SpendCategory } from '../db/enums'
import type { Logger } from '../lib/logger'

export type SpendInput = {
  category: SpendCategory
  units: number
  costUsd: number
  meta?: Record<string, unknown>
}

export async function recordSpend(db: Database, input: SpendInput, log: Logger) {
  if (!Number.isFinite(input.units) || !Number.isFinite(input.costUsd) || input.costUsd < 0) {
    log.warn({ category: input.category }, 'spend not recorded: invalid numbers')
    return
  }
  await db
    .insertInto('spend_ledger')
    .values({
      day: sql`(now() at time zone 'utc')::date`,
      category: input.category,
      units: String(input.units),
      cost_usd: input.costUsd.toFixed(6),
      meta: input.meta ? JSON.stringify(input.meta) : null,
    })
    .execute()
  log.debug({ category: input.category, costUsd: input.costUsd }, 'spend recorded')
}

export async function spendTodayUsd(
  db: Database,
  categories: readonly SpendCategory[],
): Promise<number> {
  if (categories.length === 0) return 0
  const row = await db
    .selectFrom('spend_ledger')
    .select(sql<string>`coalesce(sum(cost_usd), 0)`.as('total'))
    .where('day', '=', sql<Date>`(now() at time zone 'utc')::date`)
    .where('category', 'in', categories)
    .executeTakeFirst()
  return Number(row?.total ?? 0)
}
