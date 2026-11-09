import { sql } from 'kysely'
import type { Database, Logger } from '@reelset/core'
import { PERSIST_CHUNK } from '../config'
import { resolveItemTarget, type ItemTarget } from '../canonical'
import { chunked } from '../reconcile/policy'
import { itemScore, type ScoreSignal } from '../score'
import type { NormalizedMention } from '../types'

const MAX_INT4 = 2_147_483_647

export type PersistCounts = {
  fetched: number
  inserted: number
  updated: number
  newItems: number
  skipped: number
  itemIds: string[]
}

type Resolved = { mention: NormalizedMention; target: ItemTarget }

function dedupeBy<T>(rows: readonly T[], key: (row: T) => string): T[] {
  const seen = new Map<string, T>()
  for (const row of rows) if (!seen.has(key(row))) seen.set(key(row), row)
  return [...seen.values()]
}

// One transaction per chunk, so an interrupted run never leaves an item without its mention.
async function persistChunk(
  trx: Database,
  chunk: readonly Resolved[],
  counts: PersistCounts,
  touched: Set<string>,
): Promise<void> {
  // A multi-row upsert cannot touch the same conflict key twice, so collapse duplicates first.
  const earliest = new Map<string, Resolved & { publishedAt: Date }>()
  for (const r of chunk) {
    const prev = earliest.get(r.target.canonicalKey)
    if (!prev) earliest.set(r.target.canonicalKey, { ...r, publishedAt: r.mention.publishedAt })
    else if (r.mention.publishedAt < prev.publishedAt) prev.publishedAt = r.mention.publishedAt
  }
  const itemRows = await trx
    .insertInto('item')
    .values(
      [...earliest.values()].map((r) => ({
        canonical_key: r.target.canonicalKey,
        canonical_url: r.target.canonicalUrl,
        kind: r.target.kind,
        title: r.mention.title,
        published_at: r.publishedAt,
      })),
    )
    .onConflict((oc) =>
      oc.column('canonical_key').doUpdateSet({
        published_at: sql`least(item.published_at, excluded.published_at)`,
        updated_at: sql`now()`,
      }),
    )
    .returning(['id', 'canonical_key', sql<boolean>`(xmax = 0)`.as('inserted')])
    .execute()
  const itemIdByKey = new Map<string, string>()
  for (const row of itemRows) {
    itemIdByKey.set(row.canonical_key, row.id)
    touched.add(row.id)
    if (row.inserted) counts.newItems++
  }

  const unique = dedupeBy(chunk, (r) => `${r.mention.source}\u0000${r.mention.externalId}`)
  const mentionRows = await trx
    .insertInto('mention')
    .values(
      unique.map(({ mention, target }) => ({
        item_id: itemIdByKey.get(target.canonicalKey)!,
        source: mention.source,
        kind: mention.kind,
        external_id: mention.externalId,
        url: mention.url,
        title: mention.title,
        author: mention.author,
        body: mention.body,
        score: mention.score === null ? null : Math.min(Math.round(mention.score), MAX_INT4),
        num_comments: mention.numComments,
        published_at: mention.publishedAt,
        raw: JSON.stringify({ extraTexts: mention.extraTexts }),
      })),
    )
    .onConflict((oc) =>
      oc.columns(['source', 'external_id']).doUpdateSet({
        title: sql`excluded.title`,
        body: sql`excluded.body`,
        score: sql`excluded.score`,
        num_comments: sql`excluded.num_comments`,
        fetched_at: sql`now()`,
        raw: sql`case when excluded.raw->'extraTexts' = '[]'::jsonb then mention.raw else excluded.raw end`,
      }),
    )
    .returning(sql<boolean>`(xmax = 0)`.as('inserted'))
    .execute()
  for (const row of mentionRows) {
    if (row.inserted) counts.inserted++
    else counts.updated++
  }
}

export async function persistMentions(
  db: Database,
  mentions: readonly NormalizedMention[],
  log: Logger,
  now = new Date(),
): Promise<PersistCounts> {
  const counts: PersistCounts = {
    fetched: mentions.length,
    inserted: 0,
    updated: 0,
    newItems: 0,
    skipped: 0,
    itemIds: [],
  }
  const touched = new Set<string>()

  const resolved: Resolved[] = []
  for (const mention of mentions) {
    const target = resolveItemTarget(mention)
    if (!target) {
      counts.skipped++
      log.warn(
        { source: mention.source, externalId: mention.externalId },
        'mention skipped, no canonical target',
      )
      continue
    }
    resolved.push({ mention, target })
  }

  for (const chunk of chunked(resolved, PERSIST_CHUNK)) {
    const run = (trx: Database) => persistChunk(trx, chunk, counts, touched)
    if (db.isTransaction) await run(db)
    else await db.transaction().execute(run)
    log.debug(
      { persisted: counts.inserted + counts.updated, total: resolved.length },
      'chunk persisted',
    )
  }

  counts.itemIds = [...touched]
  await rescoreItems(db, counts.itemIds, now, log)
  log.info(
    {
      fetched: counts.fetched,
      inserted: counts.inserted,
      updated: counts.updated,
      newItems: counts.newItems,
      skipped: counts.skipped,
    },
    'mentions persisted',
  )
  return counts
}

export async function rescoreItems(
  db: Database,
  itemIds: readonly string[],
  now: Date,
  log: Logger,
): Promise<void> {
  if (itemIds.length === 0) return
  const rows = await db
    .selectFrom('mention')
    .select(['item_id', 'source', 'score', 'num_comments', 'published_at'])
    .where('item_id', 'in', itemIds)
    .execute()

  const byItem = new Map<string, ScoreSignal[]>()
  for (const row of rows) {
    const list = byItem.get(row.item_id) ?? []
    list.push({
      source: row.source,
      score: row.score,
      numComments: row.num_comments,
      publishedAt: new Date(row.published_at),
    })
    byItem.set(row.item_id, list)
  }

  const scored = [...byItem].map(([id, signals]) => ({ id, score: itemScore(signals, now) }))
  for (const batch of chunked(scored, PERSIST_CHUNK)) {
    await sql`
      update item set score = v.score
      from unnest(${batch.map((b) => b.id)}::uuid[], ${batch.map((b) => b.score)}::float8[]) as v(id, score)
      where item.id = v.id`.execute(db)
  }
  log.debug({ items: byItem.size }, 'items rescored')
}
