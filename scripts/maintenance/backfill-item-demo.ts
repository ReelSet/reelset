import { sql } from 'kysely'
import { createDb, createLogger } from '@reelset/core'
import { captureRepoDemo, defaultDemoFetchers } from '../../workers/ingest/src/demo'

// Usage: backfill-item-demo.ts [--apply] [--limit N]
// Captures the README demo clip (gif/mp4/webm) for github items that were never checked.
// item.demo = { url, kind, bytes? } or { none: true } once checked.
const apply = process.argv.includes('--apply')
const limitArg = process.argv.indexOf('--limit')
const limit = limitArg > 0 ? Number(process.argv[limitArg + 1]) : 200
const log = createLogger({ app: 'backfill-item-demo', level: 'warn' })
const { db, close } = createDb({ connectionString: process.env.DIRECT_URL!, log, max: 2 })

try {
  const rows = await db
    .selectFrom('item')
    .select(['id', 'canonical_key'])
    .where('canonical_key', 'like', 'github:%')
    .where('status', 'in', ['rendered', 'embedded', 'voiced'])
    .where('demo', 'is', null)
    .limit(limit)
    .execute()
  console.log(`github items to check: ${rows.length} (apply=${apply})`)
  const fetchers = defaultDemoFetchers()
  let found = 0
  for (const row of rows) {
    const [owner, repo] = row.canonical_key.slice('github:'.length).split('/')
    if (!owner || !repo) continue
    const demo = await captureRepoDemo(owner, repo, fetchers, log)
    if (demo) found++
    console.log(`${owner}/${repo}: ${demo ? `${demo.kind} ${demo.bytes ?? '?'}B` : 'none'}`)
    if (apply) {
      await db
        .updateTable('item')
        .set({ demo: sql`${JSON.stringify(demo ?? { none: true })}::jsonb` })
        .where('id', '=', row.id)
        .execute()
    }
  }
  console.log(`demos found: ${found}`)
} finally {
  await close()
}
