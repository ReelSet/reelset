import { createDb, createLogger, transitionItem, type ItemStatus } from '@reelset/core'
import { sql } from 'kysely'
import {
  readmeLooksSpammy,
  spamReason,
  type GithubRepo,
} from '../../workers/ingest/src/sources/github'

const apply = process.argv.includes('--apply')
const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL
if (!connectionString) throw new Error('DIRECT_URL or DATABASE_URL must be set')

const log = createLogger({ app: 'maintenance', level: 'warn' })
const { db, close } = createDb({ connectionString, log, max: 2 })
const STUCK_RUN_MIN_AGE_MS = 15 * 60 * 1000 // a normal run finishes in ~3 min
const SPAM_ERROR = 'spam_filtered'
// Spam confirmed by hand that the automatic heuristics do not catch (no cracked-software wording).
const MANUAL_SPAM: Record<string, string> = {
  'github:copperhammerpeace/delta-force-trainer-tool':
    'manual: game trainer/aim-assist bait, not caught by spamReason',
}

type Row = {
  id: string
  canonical_key: string
  status: ItemStatus
  last_error: string | null
  title: string
  topics: string[]
  mention_title: string | null
  body: string | null
  score: number | null
  published_at: Date | null
  raw: { extraTexts?: string[] } | null
}

/*
 * Stored data vs spamReason inputs: full_name = mention.title, description/language/topics are
 * recovered from mention.body (repoToMention writes "description\nLanguage: x\nTopics: a, b"),
 * stars = mention.score, created_at = mention.published_at. The README check uses the stored
 * extraTexts. Not stored: fork/archived (irrelevant, filtered before insert) and the original
 * evaluation time (star velocity uses now(), so it can differ slightly from ingest time).
 */
function toRepo(row: Row): GithubRepo {
  const lines = (row.body ?? '').split('\n')
  const language = lines.find((l) => l.startsWith('Language: '))?.slice('Language: '.length)
  const topicsLine = lines.find((l) => l.startsWith('Topics: '))
  const topics = topicsLine ? topicsLine.slice('Topics: '.length).split(', ') : []
  const description = lines
    .filter((l) => !l.startsWith('Language: ') && !l.startsWith('Topics: '))
    .join('\n')
    .trim()
  const fullName = row.mention_title ?? row.title
  return {
    id: 0,
    full_name: fullName,
    html_url: `https://github.com/${fullName}`,
    description: description || null,
    stargazers_count: row.score ?? 0,
    created_at: (row.published_at ?? new Date()).toISOString(),
    language: language ?? null,
    topics,
  }
}

function evaluate(row: Row): string | null {
  const reason = spamReason(toRepo(row))
  if (reason) return reason
  const readme = row.raw?.extraTexts?.[0]
  if (readme && readmeLooksSpammy(readme)) return 'spammy readme'
  return null
}

const count = async () =>
  db
    .selectFrom('item')
    .select(['status', (eb) => eb.fn.countAll<string>().as('n')])
    .groupBy('status')
    .orderBy('status')
    .execute()

async function main() {
  console.log(apply ? '== APPLY ==' : '== DRY RUN (pass --apply to write) ==')
  console.log('status counts before:', JSON.stringify(await count()))

  const rows = (
    await sql<Row>`
    select i.id, i.canonical_key, i.status, i.last_error, i.title, i.topics,
           m.title as mention_title, m.body, m.score, m.published_at, m.raw
    from item i
    left join lateral (
      select * from mention
      where item_id = i.id and source = 'github' and kind = 'repo' order by fetched_at limit 1
    ) m on true
    where i.canonical_key like 'github:%' and i.status in ('found','summarized','embedded','failed')
  `.execute(db)
  ).rows

  const notEvaluable = rows.filter((r) => r.mention_title === null)
  if (notEvaluable.length > 0) {
    console.log(
      `not evaluable (no github repo mention stored, left untouched): ${notEvaluable.length}`,
    )
    for (const r of notEvaluable) console.log(`  ${r.status}\t${r.canonical_key}`)
  }
  const flagged = rows
    .filter((r) => r.mention_title !== null || MANUAL_SPAM[r.canonical_key])
    .map((row) => ({ row, reason: MANUAL_SPAM[row.canonical_key] ?? evaluate(row) }))
    .filter((x): x is { row: Row; reason: string } => x.reason !== null)
  console.log(`github items evaluated: ${rows.length}, flagged: ${flagged.length}`)
  const byStatus: Record<string, number> = {}
  for (const f of flagged) byStatus[f.row.status] = (byStatus[f.row.status] ?? 0) + 1
  console.log('flagged by status:', JSON.stringify(byStatus))
  for (const f of flagged) console.log(`  ${f.row.status}\t${f.row.canonical_key}\t${f.reason}`)

  const flaggedIds = new Set(flagged.map((f) => f.row.id))
  const failed = (
    await sql<{ id: string; canonical_key: string; last_error: string | null; attempts: number }>`
    select id, canonical_key, last_error, attempts from item where status = 'failed'
  `.execute(db)
  ).rows
  const retry = failed.filter((f) => !flaggedIds.has(f.id) && f.last_error !== SPAM_ERROR)
  console.log(`failed items to retry (not spam): ${retry.length}`)
  for (const r of retry)
    console.log(
      `  ${r.canonical_key}\tattempts=${r.attempts}\t${(r.last_error ?? '').slice(0, 100)}`,
    )

  const stuck = (
    await sql<{ id: string; started_at: Date; heartbeat_at: Date }>`
    select id, started_at, heartbeat_at from ingest_run
    where status = 'running' and heartbeat_at < ${new Date(Date.now() - STUCK_RUN_MIN_AGE_MS)}
  `.execute(db)
  ).rows
  console.log(`stuck ingest runs: ${stuck.length}`)
  for (const s of stuck)
    console.log(
      `  ${s.id}\tstarted=${s.started_at.toISOString()}\theartbeat=${s.heartbeat_at.toISOString()}`,
    )

  if (apply) {
    for (const { row, reason } of flagged) {
      if (row.status === 'failed') {
        if (row.last_error === SPAM_ERROR) continue
        await sql`update item set last_error = ${SPAM_ERROR}, updated_at = now() where id = ${row.id} and status = 'failed'`.execute(
          db,
        )
        console.log(`updated last_error: ${row.canonical_key}`)
      } else {
        await transitionItem(
          db,
          {
            itemId: row.id,
            from: row.status,
            to: 'failed',
            error: SPAM_ERROR,
            meta: { reason, script: 'cleanup-spam-and-retry' },
          },
          log,
        )
        console.log(`transitioned ${row.status} -> failed: ${row.canonical_key}`)
      }
    }
    for (const r of retry) {
      await db.transaction().execute(async (trx) => {
        await transitionItem(trx, { itemId: r.id, from: 'failed', to: 'found' }, log)
        await sql`update item set queued_at = null, attempts = 0, updated_at = now() where id = ${r.id}`.execute(
          trx,
        )
      })
      console.log(`retry failed -> found: ${r.canonical_key}`)
    }
    if (stuck.length > 0) {
      const ids = stuck.map((s) => s.id)
      await db.transaction().execute(async (trx) => {
        await sql`update ingest_run set status = 'failed', finished_at = now() where id = any(${ids}::uuid[]) and status = 'running'`.execute(
          trx,
        )
        const t =
          await sql`update ingest_task set status = 'failed', error = 'run abandoned (worker stopped before finishing)', finished_at = now()
          where run_id = any(${ids}::uuid[]) and status in ('queued','running')`.execute(trx)
        console.log(`closed ${ids.length} runs, ${t.numAffectedRows} tasks`)
      })
    }
  }

  console.log('status counts after:', JSON.stringify(await count()))
  const embedded = await db
    .selectFrom('item')
    .select(['canonical_key', 'title', 'status'])
    .where('status', '=', 'embedded')
    .execute()
  console.log('embedded items:')
  for (const e of embedded) console.log(`  ${e.canonical_key}\t${e.title}`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(close)
