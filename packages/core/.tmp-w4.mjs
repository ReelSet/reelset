import pg from 'pg'
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await c.connect()
const r = (await c.query(`select r.status, r.box, round(r.render_ms/60000.0,1) render_min, r.video_key is not null has_video, left(r.error,120) error, i.status item from render r join item i on i.id=r.item_id where r.item_id='89c3a1dd-2bb9-48e6-b62d-c9ec52722fb5' order by r.created_at desc limit 1`)).rows[0]
console.log(JSON.stringify(r))
await c.end()
