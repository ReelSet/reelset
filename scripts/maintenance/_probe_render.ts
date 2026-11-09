import { createDb, createLogger } from '@reelset/core'
import { sql } from 'kysely'
const log = createLogger({ app: 'm', level: 'warn' })
const { db, close } = createDb({ connectionString: process.env.DIRECT_URL!, log, max: 1 })
const r =
  await sql`select i.id, i.status, i.kind, left(i.title,45) t, i.canonical_url, (select string_agg(distinct source::text,',') from mention m where m.item_id=i.id) srcs, (select count(*) from render r where r.item_id=i.id and r.status='done') done, (i.script is not null) hasscript from item i where i.status='rendered' order by i.published_at desc`.execute(
    db,
  )
console.table(r.rows)
const m =
  await sql`select source, kind, url, left(raw::text,200) raw from mention where source in ('github','youtube','reddit') limit 6`.execute(
    db,
  )
console.log(JSON.stringify(m.rows, null, 1))
await close()
