import { createDb, createLogger, transitionItem } from '@reelset/core'
import { sql } from 'kysely'

// Admin Retry (docs/contracts.md) for specific failed items given as id prefixes.
const apply = process.argv.includes('--apply')
const prefixes = process.argv.slice(2).filter((a) => !a.startsWith('--'))
if (prefixes.length === 0) throw new Error('usage: retry-by-prefix <itemIdPrefix>... [--apply]')
const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL
if (!connectionString) throw new Error('DIRECT_URL or DATABASE_URL must be set')

const log = createLogger({ app: 'maintenance', level: 'info' })
const { db, close } = createDb({ connectionString, log, max: 1 })
try {
  for (const prefix of prefixes) {
    const rows = await sql<{ id: string; status: string }>`
      select id, status from item where id::text like ${prefix + '%'}`.execute(db)
    if (rows.rows.length !== 1 || rows.rows[0]!.status !== 'failed') {
      log.warn({ prefix, matches: rows.rows.length, status: rows.rows[0]?.status }, 'skipped')
      continue
    }
    const itemId = rows.rows[0]!.id
    log.info({ itemId, apply }, 'retrying failed item -> embedded')
    if (!apply) continue
    await db.transaction().execute(async (trx) => {
      await transitionItem(
        trx,
        { itemId, from: 'failed', to: 'embedded', meta: { adminRetry: true } },
        log,
      )
      await sql`update item set queued_at = null, attempts = 0 where id = ${itemId}`.execute(trx)
    })
  }
} finally {
  await close()
}
