import { createDb, createLogger } from '@reelset/core'
import { sql } from 'kysely'
import { persistMentions } from '../../workers/ingest/src/ingest/persist'
import { sweepStuckRuns } from '../../workers/ingest/src/ingest/repo'
const log = createLogger({ app: 'smoke', level: 'fatal' })
const h = createDb({ connectionString: process.env.DIRECT_URL!, log, max: 1 })
class Rollback extends Error {}
try {
  await h.db.transaction().execute(async (trx) => {
    const ms = Array.from({ length: 1000 }, (_, i) => ({
      source: 'hn' as const, externalId: `smoke-${i}`, kind: 'post' as const,
      url: `https://news.ycombinator.com/item?id=9${i}`, linkedUrl: `https://example.com/smoke/${i}`,
      title: `smoke ${i}`, author: 'x', body: null, score: 10 + i, numComments: 3,
      publishedAt: new Date(), extraTexts: [],
    }))
    const t0 = Date.now()
    const c = await persistMentions(trx as any, ms as any, log)
    console.log('persist 1000 ms', Date.now() - t0, JSON.stringify({ ...c, itemIds: c.itemIds.length }))
    const t1 = Date.now()
    const c2 = await persistMentions(trx as any, ms as any, log)
    console.log('re-persist ms', Date.now() - t1, JSON.stringify({ ...c2, itemIds: c2.itemIds.length }))
    const orphan = await sql<{ n: string }>`select count(*) n from item i where i.canonical_url like 'https://example.com/smoke/%' and not exists (select 1 from mention m where m.item_id=i.id)`.execute(trx)
    console.log('orphans', JSON.stringify(orphan.rows))
    const sw = await sweepStuckRuns(trx as any, new Date(Date.now() - 5 * 60000), log)
    console.log('sweep', JSON.stringify(sw))
    const st = await sql`select id, status from ingest_run where id::text like '1613d41d%'`.execute(trx)
    console.log('run 1613d41d after sweep', JSON.stringify(st.rows))
    throw new Rollback()
  })
} catch (e) { if (!(e instanceof Rollback)) console.log('ERR', (e as Error).message) }
const after = await sql`select count(*) n from item where canonical_url like 'https://example.com/smoke/%'`.execute(h.db)
console.log('leftover smoke items after rollback', JSON.stringify(after.rows))
await h.close()
