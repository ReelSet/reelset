import { createDb, createLogger } from '@reelset/core'
import { sql } from 'kysely'

// Marks done renders whose item_id starts with the given prefixes AND whose render_key starts
// with the given prefixes as failed ('stale_container_template'). Rows and R2 objects are kept;
// the feed falls back to the previous done render and the render cron re-queues the item.
const apply = process.argv.includes('--apply')
const pairs = process.argv
  .slice(2)
  .filter((a) => a.includes(':'))
  .map((a) => a.split(':') as [string, string])
if (pairs.length === 0) throw new Error('usage: <itemPrefix>:<renderKeyPrefix> ... [--apply]')
const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL
if (!connectionString) throw new Error('DIRECT_URL or DATABASE_URL must be set')

const log = createLogger({ app: 'maintenance', level: 'info' })
const { db, close } = createDb({ connectionString, log, max: 1 })
try {
  for (const [itemPrefix, keyPrefix] of pairs) {
    const rows = await sql<{ id: string; item_id: string; status: string; render_key: string }>`
      select id, item_id, status, render_key from render
      where item_id::text like ${itemPrefix + '%'} and render_key like ${keyPrefix + '%'}`.execute(
      db,
    )
    if (rows.rows.length !== 1) {
      log.error({ itemPrefix, keyPrefix, matches: rows.rows.length }, 'expected exactly one row')
      continue
    }
    const row = rows.rows[0]!
    log.info({ renderId: row.id, itemId: row.item_id, status: row.status, apply }, 'stale render')
    if (apply && row.status === 'done') {
      await sql`update render set status = 'failed', error = 'stale_container_template',
        finished_at = now() where id = ${row.id} and status = 'done'`.execute(db)
      log.info({ renderId: row.id }, 'marked failed')
    }
  }
} finally {
  await close()
}
