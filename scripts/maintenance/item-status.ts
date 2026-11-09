import { createDb, createLogger } from '@reelset/core'
import { sql } from 'kysely'

// Read-only: status of items by id prefix, with their renders.
const prefixes = process.argv.slice(2)
const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL
if (!connectionString) throw new Error('DIRECT_URL or DATABASE_URL must be set')
const log = createLogger({ app: 'maintenance', level: 'error' })
const { db, close } = createDb({ connectionString, log, max: 1 })
try {
  for (const prefix of prefixes) {
    const items = await sql`select left(id::text, 8) id, status, score, attempts, queued_at,
      left(coalesce(last_error, ''), 120) last_error from item where id::text like ${prefix + '%'}`.execute(
      db,
    )
    console.table(items.rows)
    const renders = await sql`select left(render_key, 8) key, status, error, video_key,
      finished_at from render where item_id::text like ${prefix + '%'} order by created_at`.execute(
      db,
    )
    console.table(renders.rows)
  }
} finally {
  await close()
}
