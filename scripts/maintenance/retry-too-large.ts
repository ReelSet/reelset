import { createDb, createLogger, transitionItem } from '@reelset/core'
import { sql } from 'kysely'

// Admin Retry (docs/contracts.md) for items whose render failed with too_large.
const apply = process.argv.includes('--apply')
const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL
if (!connectionString) throw new Error('DIRECT_URL or DATABASE_URL must be set')

const log = createLogger({ app: 'maintenance', level: 'info' })
const { db, close } = createDb({ connectionString, log, max: 1 })
try {
  const rows = await db
    .selectFrom('render as r')
    .innerJoin('item as i', 'i.id', 'r.item_id')
    .select(['r.id as renderId', 'i.id as itemId'])
    .where('i.status', '=', 'failed')
    .where('r.status', '=', 'failed')
    .where('r.error', '=', 'too_large')
    .execute()
  log.info({ count: rows.length, apply }, 'too_large renders found')
  if (apply) {
    for (const row of rows) {
      await db.transaction().execute(async (trx) => {
        await transitionItem(
          trx,
          { itemId: row.itemId, from: 'failed', to: 'embedded', meta: { adminRetry: true } },
          log,
        )
        await sql`update item set queued_at = null, attempts = 0 where id = ${row.itemId}`.execute(
          trx,
        )
        await sql`update render set attempts = 0 where id = ${row.renderId}`.execute(trx)
      })
      log.info({ itemId: row.itemId }, 'item reset to embedded')
    }
  }
} finally {
  await close()
}
