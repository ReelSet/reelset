import { sql } from 'kysely'
import { errorFields, type Database, type Logger } from '@reelset/core'
import {
  ARCTIC_HOST_INTERVAL_MS,
  REDDIT_MIN_COMMENTS_FOR_TREE,
  REDDIT_REFRESH_BATCH,
  REDDIT_REFRESH_PAGES,
  REDDIT_SCORE_SETTLE_HOURS,
} from '../config'
import { fetchPostsByIds, fetchTopComments } from '../sources/reddit'
import { rescoreItems } from './persist'

const MAX_TREE_FETCHES = 10

export function settleCutoff(now: Date): Date {
  return new Date(now.getTime() - REDDIT_SCORE_SETTLE_HOURS * 60 * 60 * 1000)
}

async function refreshBatch(
  db: Database,
  log: Logger,
  now: Date,
  deadlineAt: number,
): Promise<number> {
  const l = log.child({ source: 'reddit', mod: 'reddit-refresh' })
  const due = await db
    .selectFrom('mention')
    .select(['id', 'item_id', 'external_id'])
    .where('source', '=', 'reddit')
    .where('scored_at', 'is', null)
    .where('published_at', '<', settleCutoff(now))
    .orderBy('published_at', 'asc')
    .limit(REDDIT_REFRESH_BATCH)
    .execute()
  if (due.length === 0) return 0

  const posts = new Map(
    (
      await fetchPostsByIds(
        due.map((d) => d.external_id),
        l,
        ARCTIC_HOST_INTERVAL_MS,
      )
    ).map((p) => [p.id, p]),
  )

  let treeFetches = 0
  for (const row of due) {
    const post = posts.get(row.external_id)
    if (!post) {
      await db
        .updateTable('mention')
        .set({ scored_at: sql`now()` })
        .where('id', '=', row.id)
        .execute()
      continue
    }
    const numComments = post.num_comments ?? null
    let extraTexts: string[] | null = null
    if (
      numComments !== null &&
      numComments >= REDDIT_MIN_COMMENTS_FOR_TREE &&
      treeFetches < MAX_TREE_FETCHES &&
      performance.now() < deadlineAt
    ) {
      treeFetches++
      try {
        extraTexts = await fetchTopComments(row.external_id, l, ARCTIC_HOST_INTERVAL_MS)
      } catch (err) {
        l.warn({ post: row.external_id, ...errorFields(err) }, 'reddit comment tree failed')
      }
    }
    await db
      .updateTable('mention')
      .set({
        score: post.score ?? null,
        num_comments: numComments,
        scored_at: sql`now()`,
        ...(extraTexts && extraTexts.length > 0
          ? { raw: sql`coalesce(raw, '{}'::jsonb) || ${JSON.stringify({ extraTexts })}::jsonb` }
          : {}),
      })
      .where('id', '=', row.id)
      .execute()
  }

  await rescoreItems(db, [...new Set(due.map((d) => d.item_id))], now, l)
  l.info({ refreshed: due.length, found: posts.size }, 'reddit scores refreshed')
  return due.length
}

export async function refreshRedditScores(
  db: Database,
  log: Logger,
  now: Date,
  deadlineAt: number,
): Promise<number> {
  let total = 0
  for (let page = 0; page < REDDIT_REFRESH_PAGES && performance.now() < deadlineAt; page++) {
    const refreshed = await refreshBatch(db, log, now, deadlineAt)
    total += refreshed
    if (refreshed < REDDIT_REFRESH_BATCH) break
  }
  return total
}
