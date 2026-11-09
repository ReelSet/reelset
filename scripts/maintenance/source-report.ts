import { createDb, createLogger } from '@reelset/core'
import { sql } from 'kysely'

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL
if (!connectionString) throw new Error('DIRECT_URL or DATABASE_URL must be set')

const log = createLogger({ app: 'maintenance', level: 'warn' })
const { db, close } = createDb({ connectionString, log, max: 1 })
try {
  const rows = await sql<{ source: string; status: string; n: string; avg: number; max: number }>`
    select m.source, i.status, count(distinct i.id) n, avg(i.score) avg, max(i.score) max
    from item i join mention m on m.item_id = i.id
    group by 1, 2 order by 1, 2`.execute(db)
  console.table(rows.rows.map((r) => ({ ...r, avg: +r.avg.toFixed(3), max: +r.max.toFixed(3) })))
} finally {
  await close()
}
