import pg from 'pg'
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await c.connect()
const s = (await c.query(`select box, count(*) n, max(at) last, bool_and(ok) all_ok from box_sample group by box`)).rows
const r = (await c.query(`select status, box, count(*) n from render where created_at > now() - interval '3 days' and (box is not null or status <> 'done') group by 1,2`)).rows
console.log(JSON.stringify({ samples: s, renders: r }))
await c.end()
