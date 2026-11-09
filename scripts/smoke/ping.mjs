import pg from 'pg'
for (const k of ['DIRECT_URL','DATABASE_URL']) {
  const c = new pg.Client({connectionString: process.env[k]})
  try { await c.connect(); const r = await c.query('select current_database() d, (select count(*) from item) items'); console.log(k, 'ok', r.rows[0]) } catch(e){ console.log(k,'ERR',e.code, e.message.replace(/\/\/[^@]*@/,'//***@')) } finally { await c.end().catch(()=>{}) }
}
