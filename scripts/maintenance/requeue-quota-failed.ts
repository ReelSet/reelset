import { createDb, createLogger, transitionItem, type ItemStatus } from '@reelset/core'
import { sql } from 'kysely'

// Moves items that failed on Gemini quota/billing errors (HTTP 402, 429 RESOURCE_EXHAUSTED) back to
// the stage they failed in, with queued_at NULL and attempts 0. Dry run unless --apply.
const apply = process.argv.includes('--apply')
const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL
if (!connectionString) throw new Error('DIRECT_URL or DATABASE_URL must be set')

const RESUMABLE: readonly ItemStatus[] = ['found', 'summarized', 'embedded']

const log = createLogger({ app: 'maintenance', level: 'info' })
const { db, close } = createDb({ connectionString, log, max: 1 })
try {
  const rows = await sql<{ id: string; last_error: string | null; prev: ItemStatus | null }>`
    select i.id, i.last_error,
      (select e.stage from item_event e
        where e.item_id = i.id and e.outcome = 'ok' and e.stage in ('found','summarized','embedded')
        order by e.created_at desc, e.id desc limit 1) as prev
    from item i
    where i.status = 'failed'
      and (i.last_error ~* 'HTTP 402|RESOURCE_EXHAUSTED|prepayment|credits are depleted')`.execute(
    db,
  )
  log.info({ count: rows.rows.length, apply }, 'quota-failed items found')

  const counts: Record<string, number> = {}
  for (const row of rows.rows) {
    const to: ItemStatus = row.prev && RESUMABLE.includes(row.prev) ? row.prev : 'found'
    counts[to] = (counts[to] ?? 0) + 1
    if (!apply) continue
    await db.transaction().execute(async (trx) => {
      await transitionItem(
        trx,
        { itemId: row.id, from: 'failed', to, meta: { requeue: 'llm_quota' } },
        log,
      )
      await sql`update item set queued_at = null, attempts = 0 where id = ${row.id}`.execute(trx)
    })
  }
  log.info({ counts, apply }, apply ? 'items requeued' : 'dry run, pass --apply to requeue')
} finally {
  await close()
}
