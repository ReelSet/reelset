import { createDb, createLogger, renderKey } from '@reelset/core'
import { sql } from 'kysely'
import { DEFAULT_VOICE, TEMPLATE_VERSION } from '../../workers/render/src/constants'
import { currentVoice } from './_effective-voice'

// Read-only: rendered items by the newest template version that has a done render, plus recent throughput.
const log = createLogger({ app: 'maintenance', level: 'warn' })
const { db, close } = createDb({ connectionString: process.env.DIRECT_URL!, log, max: 1 })
try {
  const voice = await currentVoice(db)
  console.log('render key voice:', voice)
  const items = await sql<{ id: string; content_hash: string; prompt_version: string }>`
    select id, content_hash, prompt_version from item
    where status = 'rendered' and content_hash is not null`.execute(db)
  const counts: Record<string, number> = {}
  for (const item of items.rows) {
    let newest = 'none'
    for (let v = Number(TEMPLATE_VERSION); v >= 1; v--) {
      const keys = await Promise.all(
        [...new Set([voice, DEFAULT_VOICE])].map((name) =>
          renderKey({
            itemId: item.id,
            contentHash: item.content_hash,
            promptVersion: item.prompt_version,
            templateVersion: String(v),
            voice: name,
          }),
        ),
      )
      const r =
        await sql`select 1 from render where render_key in (${sql.join(keys)}) and status = 'done'`.execute(
          db,
        )
      if (r.rows.length > 0) {
        newest = String(v)
        break
      }
    }
    counts[newest] = (counts[newest] ?? 0) + 1
  }
  console.log('rendered items by newest done template:', counts)
  const recent = await sql<{ minutes: number; n: number }>`
    select w.m as minutes, count(r.id)::int as n
    from (values (5), (15), (60)) as w(m)
    left join render r on r.status = 'done' and r.finished_at > now() - make_interval(mins => w.m)
    group by w.m order by w.m`.execute(db)
  console.log('renders done in last N minutes:', recent.rows)
} finally {
  await close()
}
