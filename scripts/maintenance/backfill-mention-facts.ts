import { sql } from 'kysely'
import { createDb, createLogger } from '@reelset/core'
import { fetchLatestRelease, repoSchema } from '../../workers/ingest/src/sources/github'

// Usage: backfill-mention-facts.ts [--apply] [--limit N]
// Adds forks/language/topics/latest release to github mentions captured before facts existed.
const apply = process.argv.includes('--apply')
const limitArg = process.argv.indexOf('--limit')
const limit = limitArg > 0 ? Number(process.argv[limitArg + 1]) : 200
const token = process.env.GITHUB_TOKEN
const log = createLogger({ app: 'backfill-mention-facts', level: 'warn' })
const { db, close } = createDb({ connectionString: process.env.DIRECT_URL!, log, max: 2 })

try {
  const rows = await db
    .selectFrom('mention')
    .innerJoin('item', 'item.id', 'mention.item_id')
    .select(['mention.id', 'mention.title'])
    .where('mention.source', '=', 'github')
    .where('item.status', 'in', ['rendered', 'embedded', 'voiced'])
    .where(sql<boolean>`mention.raw->'facts'->'forks' is null`)
    .limit(limit)
    .execute()
  console.log(`github mentions to backfill: ${rows.length} (apply=${apply})`)

  let done = 0
  for (const row of rows) {
    const res = await fetch(`https://api.github.com/repos/${row.title}`, {
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': 'reelset-backfill',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    })
    if (!res.ok) continue
    const parsed = repoSchema.safeParse(await res.json())
    if (!parsed.success) continue
    const repo = parsed.data
    const release = await fetchLatestRelease(row.title!, token, log, 0).catch(() => null)
    const facts = Object.fromEntries(
      Object.entries({
        owner: repo.owner?.login,
        name: repo.full_name.split('/')[1],
        description: repo.description?.trim() || null,
        forks: repo.forks_count ?? null,
        language: repo.language ?? null,
        topics: repo.topics?.length ? repo.topics.slice(0, 8) : null,
        latestRelease: release?.tag ?? null,
        latestReleaseAt: release?.publishedAt ?? null,
      }).filter(([, v]) => v !== null && v !== undefined),
    )
    if (apply) {
      await db
        .updateTable('mention')
        .set({
          raw: sql`coalesce(raw, '{}'::jsonb) || jsonb_build_object('facts', coalesce(raw->'facts', '{}'::jsonb) || ${JSON.stringify(facts)}::jsonb)`,
        })
        .where('id', '=', row.id)
        .execute()
    }
    done++
  }
  console.log(`backfilled: ${done}`)
} finally {
  await close()
}
