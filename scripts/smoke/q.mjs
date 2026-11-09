import pg from 'pg'
const c = new pg.Client({connectionString: process.env.DIRECT_URL}); await c.connect()
for (const q of process.argv.slice(2)) { try { const r = await c.query(q); console.log(q.slice(0,90),'\n', JSON.stringify(r.rows.slice(0,40))) } catch(e){ console.log('ERR', q.slice(0,90), e.message) } }
await c.end()
