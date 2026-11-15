import {
  hideItems,
  unhideItems,
  type Database,
  type HiddenReason,
  type Logger,
} from '@reelset/core'
import { sql } from 'kysely'
import { SPAM_SCAN_LIMIT } from '@/lib/admin/moderation'
import { findSpamSuspects, type SpamScanRow, type SpamSuspect } from '@/lib/admin/spam'
import type { CommandResult } from './commands'

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`

export async function hideSelected(
  db: Database,
  input: { itemIds: string[]; reason: HiddenReason },
  log: Logger,
): Promise<CommandResult> {
  const result = await hideItems(db, input, log)
  if (result.changed === 0)
    return { ok: false, message: 'Nothing hidden: those items are not public' }
  const skipped = input.itemIds.length - result.changed
  const parts = [`Hidden ${plural(result.changed, 'item')}`]
  if (result.cancelledPosts > 0) {
    parts.push(`${plural(result.cancelledPosts, 'queued Instagram post')} cancelled`)
  }
  if (skipped > 0) parts.push(`${skipped} skipped (not public)`)
  return { ok: true, message: parts.join(', ') }
}

export async function unhideSelected(
  db: Database,
  input: { itemIds: string[] },
  log: Logger,
): Promise<CommandResult> {
  const changed = await unhideItems(db, input, log)
  if (changed === 0) return { ok: false, message: 'Nothing to unhide: those items are not hidden' }
  return { ok: true, message: `Unhidden ${plural(changed, 'item')}` }
}

export async function visibilityCounts(db: Database) {
  const rows = await db
    .selectFrom('item')
    .select(['visibility', (eb) => eb.fn.countAll<string>().as('n')])
    .groupBy('visibility')
    .execute()
  const by = new Map(rows.map((r) => [r.visibility, Number(r.n)]))
  const count = (key: string) => by.get(key) ?? 0
  return {
    all: [...by.values()].reduce((sum, n) => sum + n, 0),
    public: count('public'),
    hidden: count('hidden'),
    private: count('private'),
  }
}

type ScanRow = Omit<SpamScanRow, 'facts'> & { facts: unknown }

const README_SCAN_CHARS = 2000

async function scanGithubItems(db: Database): Promise<SpamScanRow[]> {
  const { rows } = await sql<ScanRow>`
    select i.id, i.title, m.stars, coalesce(m.created_at, i.published_at) as "createdAt",
      m.author, m.facts, m.readme
    from item i
    left join lateral (
      select score as stars, published_at as created_at, author, raw -> 'facts' as facts,
        left(raw -> 'extraTexts' ->> 0, ${README_SCAN_CHARS}) as readme
      from mention
      where item_id = i.id and source = 'github'
      order by score desc nulls last
      limit 1
    ) m on true
    where i.visibility = 'public' and split_part(i.canonical_key, ':', 1) = 'github'
    order by i.first_seen_at desc
    limit ${SPAM_SCAN_LIMIT}`.execute(db)
  return rows
}

/** Public GitHub items the ingest spam heuristic would reject today, newest SPAM_SCAN_LIMIT scanned. */
export async function listSpamSuspects(db: Database, now = new Date()): Promise<SpamSuspect[]> {
  return findSpamSuspects(await scanGithubItems(db), now)
}
