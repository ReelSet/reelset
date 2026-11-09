import pg from 'pg'
import { reelScriptSchema } from '@reelset/core'
const c = new pg.Client({ connectionString: process.env.DIRECT_URL }); await c.connect()
const items = (await c.query(`select id,title,tldr,script,content_hash,vector_dims(embedding) d,topics,day_check from (select i.*, current_date::text day_check from item i) i where status='embedded'`)).rows
for (const it of items) {
  const parsed = reelScriptSchema.safeParse(it.script)
  const chunkIds = new Set((await c.query('select id from evidence_chunk where item_id=$1', [it.id])).rows.map((r) => r.id))
  const claims = parsed.success ? parsed.data.claims : []
  const bad = claims.filter((cl) => cl.chunkIds.some((id) => !chunkIds.has(id)))
  const ec = (await c.query('select count(*) n, count(embedding) e, min(vector_dims(embedding)) mind, max(vector_dims(embedding)) maxd from evidence_chunk where item_id=$1', [it.id])).rows[0]
  console.log(JSON.stringify({ id: it.id.slice(0, 8), title: it.title, tldrLen: it.tldr.length, scriptValid: parsed.success, err: parsed.success ? null : parsed.error.issues.slice(0, 2), claims: claims.length, claimsWithForeignChunk: bad.length, itemEmbDims: it.d, hash: !!it.content_hash, topics: it.topics, chunks: ec }))
}
console.log((await c.query(`select day::text, current_date::text cd, count(*) from spend_ledger group by 1`)).rows)
console.log((await c.query(`select count(*) from item_event e join item i on i.id=e.item_id where i.status='embedded'`)).rows)
await c.end()
