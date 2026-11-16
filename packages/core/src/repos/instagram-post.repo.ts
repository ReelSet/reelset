import { sql, type Selectable } from 'kysely'
import type { Database } from '../db/client'
import type { InstagramPost } from '../db/types'
import { InstagramPostStatus, Source } from '../db/enums'
import {
  INSTAGRAM_MIN_GAP_MINUTES,
  INSTAGRAM_LOST_ERROR,
  INSTAGRAM_LOST_RECHECK_DAYS,
  INSTAGRAM_NOT_FOUND_ERROR,
  INSTAGRAM_POSTING_STUCK_MINUTES,
  LEGACY_INSTAGRAM_LOST_ERROR as LEGACY_LOST_ERROR,
  assertPostTransition,
  isLostLookupPending,
  igAccountSchema,
  type IgAccount,
  type InstagramPublisher,
} from '../domain/instagram-post'
import type { Logger } from '../lib/logger'

export const IG_ACCOUNT_KEY = 'ig_account'
export const IG_SESSION_KEY = 'ig_session_enc'
export const IG_CHECK_ERROR_KEY = 'ig_check_error'
export const IG_CREDENTIALS_KEY = 'ig_credentials_enc'
export const IG_OFFICIAL_ACCOUNT_KEY = 'ig_official_account'
export const IG_OFFICIAL_TOKEN_KEY = 'ig_official_token_enc'
export const IG_STATS_SYNCED_KEY = 'ig_stats_synced_at'

export type IgCheckError = { message: string; at: string }

export type ClaimedPost = Selectable<
  Pick<InstagramPost, 'id' | 'item_id' | 'video_key' | 'caption' | 'media_pk' | 'attempts'>
>
const CLAIM_COLUMNS = sql`id, item_id, video_key, caption, media_pk, attempts`

// One statement: the SKIP LOCKED pick, the in-flight check and the gap check cannot interleave.
export async function claimNextPost(
  db: Database,
  log: Logger,
  minGapMinutes = INSTAGRAM_MIN_GAP_MINUTES,
): Promise<ClaimedPost | null> {
  const { rows } = await sql<ClaimedPost>`
    update instagram_post set status = 'posting', started_at = now(), updated_at = now(),
      attempts = attempts + 1, error = null
    where id = (
      select id from instagram_post where status = 'queued'
      order by created_at limit 1 for update skip locked
    )
    and not exists (
      select 1 from instagram_post
      where status in ('posting', 'deleting')
        or posted_at > now() - make_interval(mins => ${minGapMinutes})
    )
    returning ${CLAIM_COLUMNS}`.execute(db)
  const post = rows[0] ?? null
  if (post) log.info({ postId: post.id, itemId: post.item_id }, 'instagram post claimed')
  return post
}

export async function claimNextDelete(db: Database, log: Logger): Promise<ClaimedPost | null> {
  const { rows } = await sql<ClaimedPost>`
    update instagram_post set status = 'deleting', started_at = now(), updated_at = now(), error = null
    where id = (
      select id from instagram_post
      where status = 'posted' and delete_requested_at is not null and media_pk is not null
      order by delete_requested_at limit 1 for update skip locked
    )
    and not exists (select 1 from instagram_post where status in ('posting', 'deleting'))
    returning ${CLAIM_COLUMNS}`.execute(db)
  const post = rows[0] ?? null
  if (post) log.info({ postId: post.id, mediaPk: post.media_pk }, 'instagram delete claimed')
  return post
}

async function moveTo(
  db: Database,
  id: string,
  from: InstagramPostStatus,
  to: InstagramPostStatus,
  set: Record<string, unknown>,
): Promise<boolean> {
  assertPostTransition(from, to)
  const res = await db
    .updateTable('instagram_post')
    .set({ ...set, status: to, updated_at: sql`now()` })
    .where('id', '=', id)
    .where('status', '=', from)
    .executeTakeFirst()
  return Number(res.numUpdatedRows) === 1
}

const S = InstagramPostStatus

export const markPosted = (db: Database, id: string, r: { mediaPk: string; permalink: string }) =>
  moveTo(db, id, S.posting, S.posted, {
    media_pk: r.mediaPk,
    permalink: r.permalink,
    posted_at: sql`now()`,
    error: null,
  })

export const markPostFailed = (db: Database, id: string, error: string) =>
  moveTo(db, id, S.posting, S.failed, { error: error.slice(0, 500) })

export const releasePostToQueue = (db: Database, id: string, note: string) =>
  moveTo(db, id, S.posting, S.queued, { error: note.slice(0, 500), started_at: null })

export const markDeleted = (db: Database, id: string) =>
  moveTo(db, id, S.deleting, S.deleted, { error: null })

export const restoreAfterDeleteFailure = (db: Database, id: string, error: string) =>
  moveTo(db, id, S.deleting, S.posted, { error: error.slice(0, 500), delete_requested_at: null })

// A post stuck in `posting` may have reached Instagram, so it is never re-sent: it is failed as
// lost, and `listLostPosts` hands it to the Instagram lookup that settles it.
export async function failStuckPosts(db: Database, log: Logger): Promise<number> {
  const res = await db
    .updateTable('instagram_post')
    .set({
      status: S.failed,
      error: INSTAGRAM_LOST_ERROR,
      updated_at: sql`now()`,
    })
    .where('status', '=', S.posting)
    .where(
      sql<boolean>`started_at < now() - make_interval(mins => ${INSTAGRAM_POSTING_STUCK_MINUTES})`,
    )
    .executeTakeFirst()
  const n = Number(res.numUpdatedRows)
  if (n > 0) log.warn({ count: n }, 'stuck instagram posts failed')
  return n
}

export type LostPost = { id: string; item_id: string; caption: string; started_at: Date }

/** Failed-as-lost posts still worth looking up on Instagram, newest first. */
export async function listLostPosts(db: Database, limit = 1): Promise<LostPost[]> {
  const rows = await db
    .selectFrom('instagram_post')
    .select(['id', 'item_id', 'caption', 'started_at'])
    .where('status', '=', S.failed)
    .where('error', 'in', [INSTAGRAM_LOST_ERROR, LEGACY_LOST_ERROR])
    .where('started_at', 'is not', null)
    .where(sql<boolean>`started_at > now() - make_interval(days => ${INSTAGRAM_LOST_RECHECK_DAYS})`)
    .orderBy('started_at', 'desc')
    .limit(limit)
    .execute()
  return rows.map((r) => ({ ...r, started_at: new Date(r.started_at as Date) }))
}

/** Media already recorded for posts, so a lost-upload lookup never claims another post's reel. */
export async function listRecentMediaPks(db: Database): Promise<string[]> {
  const rows = await db
    .selectFrom('instagram_post')
    .select('media_pk')
    .where('media_pk', 'is not', null)
    .where(
      sql<boolean>`created_at > now() - make_interval(days => ${INSTAGRAM_LOST_RECHECK_DAYS + 1})`,
    )
    .execute()
  return rows.map((r) => r.media_pk).filter((pk): pk is string => !!pk)
}

export const markLostFound = (
  db: Database,
  id: string,
  r: { mediaPk: string; permalink: string },
) =>
  moveTo(db, id, S.failed, S.posted, {
    media_pk: r.mediaPk,
    permalink: r.permalink,
    posted_at: sql`coalesce(started_at, now())`,
    error: null,
  })

export async function markLostNotFound(db: Database, id: string): Promise<boolean> {
  const res = await db
    .updateTable('instagram_post')
    .set({ error: INSTAGRAM_NOT_FOUND_ERROR, updated_at: sql`now()` })
    .where('id', '=', id)
    .where('status', '=', S.failed)
    .where('error', 'in', [INSTAGRAM_LOST_ERROR, LEGACY_LOST_ERROR])
    .executeTakeFirst()
  return Number(res.numUpdatedRows) === 1
}

export type RetryPostResult =
  | { changed: true }
  | {
      changed: false
      reason:
        'not_found' | 'not_failed' | 'still_checking' | 'already_live_or_queued' | 'item_hidden'
    }

const LIVE_STATUSES = [S.queued, S.posting, S.posted, S.deleting]
const UNIQUE_VIOLATION_CODE = '23505'

async function whyNotRetryable(db: Database, id: string): Promise<RetryPostResult> {
  const row = await db
    .selectFrom('instagram_post')
    .select(['item_id', 'status', 'error', 'started_at'])
    .where('id', '=', id)
    .executeTakeFirst()
  if (!row) return { changed: false, reason: 'not_found' }
  if (row.status !== S.failed) return { changed: false, reason: 'not_failed' }
  const startedAt = row.started_at ? new Date(row.started_at as Date) : null
  if (isLostLookupPending(row.error, startedAt, new Date())) {
    return { changed: false, reason: 'still_checking' }
  }
  const item = await db
    .selectFrom('item')
    .select('visibility')
    .where('id', '=', row.item_id)
    .executeTakeFirst()
  if (item?.visibility === 'hidden') return { changed: false, reason: 'item_hidden' }
  const live = await db
    .selectFrom('instagram_post')
    .select('id')
    .where('item_id', '=', row.item_id)
    .where('id', '!=', id)
    .where('status', 'in', LIVE_STATUSES)
    .executeTakeFirst()
  return { changed: false, reason: live ? 'already_live_or_queued' : 'not_failed' }
}

/** Re-queues a failed post in one statement; refuses while a lost upload is being looked up or the item has a live post. */
export async function retryInstagramPost(db: Database, id: string): Promise<RetryPostResult> {
  assertPostTransition(S.failed, S.queued)
  try {
    const res = await db
      .updateTable('instagram_post')
      .set({ status: S.queued, error: null, started_at: null, updated_at: sql`now()` })
      .where('id', '=', id)
      .where('status', '=', S.failed)
      .where(
        sql<boolean>`not coalesce(
          error in (${INSTAGRAM_LOST_ERROR}, ${LEGACY_LOST_ERROR})
            and started_at > now() - make_interval(days => ${INSTAGRAM_LOST_RECHECK_DAYS}),
          false
        )`,
      )
      .where(
        sql<boolean>`not exists (
          select 1 from instagram_post o where o.item_id = instagram_post.item_id
            and o.id <> instagram_post.id and o.status in ('queued', 'posting', 'posted', 'deleting')
        )`,
      )
      .where(
        sql<boolean>`not exists (
          select 1 from item i where i.id = instagram_post.item_id and i.visibility = 'hidden'
        )`,
      )
      .executeTakeFirst()
    if (Number(res.numUpdatedRows) === 1) return { changed: true }
  } catch (err) {
    if ((err as { code?: string }).code !== UNIQUE_VIOLATION_CODE) throw err
    return { changed: false, reason: 'already_live_or_queued' }
  }
  return whyNotRetryable(db, id)
}

export async function getIgAccount(db: Database): Promise<IgAccount | null> {
  const row = await db
    .selectFrom('app_setting')
    .select('value')
    .where('key', '=', IG_ACCOUNT_KEY)
    .executeTakeFirst()
  const parsed = igAccountSchema.safeParse(row?.value)
  return parsed.success ? parsed.data : null
}

async function putSetting(db: Database, key: string, value: unknown): Promise<void> {
  const json = JSON.stringify(value)
  await db
    .insertInto('app_setting')
    .values({ key, value: json })
    .onConflict((oc) => oc.column('key').doUpdateSet({ value: json, updated_at: sql`now()` }))
    .execute()
}

export const setIgAccount = (db: Database, account: IgAccount) =>
  putSetting(db, IG_ACCOUNT_KEY, account)

export async function getEncryptedSession(db: Database): Promise<string | null> {
  const row = await db
    .selectFrom('app_setting')
    .select('value')
    .where('key', '=', IG_SESSION_KEY)
    .executeTakeFirst()
  return typeof row?.value === 'string' ? row.value : null
}

export const setEncryptedSession = (db: Database, blob: string) =>
  putSetting(db, IG_SESSION_KEY, blob)

export async function getEncryptedCredentials(db: Database): Promise<string | null> {
  const row = await db
    .selectFrom('app_setting')
    .select('value')
    .where('key', '=', IG_CREDENTIALS_KEY)
    .executeTakeFirst()
  return typeof row?.value === 'string' ? row.value : null
}

export const setEncryptedCredentials = (db: Database, blob: string) =>
  putSetting(db, IG_CREDENTIALS_KEY, blob)

/** Forgets the saved session (and its device ids) and any credentials entered in the admin. */
export async function clearIgConnection(db: Database): Promise<void> {
  await db
    .deleteFrom('app_setting')
    .where('key', 'in', [IG_SESSION_KEY, IG_CREDENTIALS_KEY, IG_CHECK_ERROR_KEY])
    .execute()
}

async function getStringSetting(db: Database, key: string): Promise<string | null> {
  const row = await db
    .selectFrom('app_setting')
    .select('value')
    .where('key', '=', key)
    .executeTakeFirst()
  return typeof row?.value === 'string' ? row.value : null
}

export async function getOfficialIgAccount(db: Database): Promise<IgAccount | null> {
  const row = await db
    .selectFrom('app_setting')
    .select('value')
    .where('key', '=', IG_OFFICIAL_ACCOUNT_KEY)
    .executeTakeFirst()
  const parsed = igAccountSchema.safeParse(row?.value)
  return parsed.success ? parsed.data : null
}

export const setOfficialIgAccount = (db: Database, account: IgAccount) =>
  putSetting(db, IG_OFFICIAL_ACCOUNT_KEY, account)

export const getEncryptedOfficialToken = (db: Database) =>
  getStringSetting(db, IG_OFFICIAL_TOKEN_KEY)

export const setEncryptedOfficialToken = (db: Database, blob: string) =>
  putSetting(db, IG_OFFICIAL_TOKEN_KEY, blob)

export async function clearOfficialIgToken(db: Database): Promise<void> {
  await db.deleteFrom('app_setting').where('key', '=', IG_OFFICIAL_TOKEN_KEY).execute()
}

export const getIgAccountFor = (db: Database, publisher: InstagramPublisher) =>
  publisher === 'official' ? getOfficialIgAccount(db) : getIgAccount(db)

/** The official API container a post is being published from; kept on the row so a rerun resumes it. */
export async function getPostContainerId(db: Database, id: string): Promise<string | null> {
  const row = await db
    .selectFrom('instagram_post')
    .select('container_id')
    .where('id', '=', id)
    .executeTakeFirst()
  return row?.container_id ?? null
}

export async function setPostContainerId(
  db: Database,
  id: string,
  containerId: string | null,
): Promise<void> {
  await db
    .updateTable('instagram_post')
    .set({ container_id: containerId, updated_at: sql`now()` })
    .where('id', '=', id)
    .execute()
}

export async function getIgCheckError(db: Database): Promise<IgCheckError | null> {
  const row = await db
    .selectFrom('app_setting')
    .select('value')
    .where('key', '=', IG_CHECK_ERROR_KEY)
    .executeTakeFirst()
  const v = row?.value as Partial<IgCheckError> | null | undefined
  return v && typeof v.message === 'string' && typeof v.at === 'string'
    ? { message: v.message, at: v.at }
    : null
}

export const setIgCheckError = (db: Database, error: IgCheckError | null) =>
  putSetting(db, IG_CHECK_ERROR_KEY, error)

// The render the feed serves (apps/web lib/ranking/sql.ts); `r` is the render alias.
export const SERVED_RENDER_ORDER_SQL =
  'coalesce(r.template_version, 0) desc, r.finished_at desc nulls last, r.created_at desc, r.id desc'

export const INSTAGRAM_AUTO_REQUESTER = 'auto'
/** Failed auto posts an item may have before it stops being retried. */
export const INSTAGRAM_AUTO_MAX_ATTEMPTS = 3
// Only reels first finished this recently are auto-posted, so turning it on never posts the archive.
export const INSTAGRAM_AUTO_LOOKBACK_HOURS = 24

const UNIQUE_VIOLATION = '23505'

type AutoCandidate = {
  id: string
  title: string
  tldr: string | null
  topics: string[]
  canonical_url: string
  hook: string | null
  video_key: string
  credits: unknown
}

export async function autoPostsQueuedToday(db: Database): Promise<number> {
  const { rows } = await sql<{ n: string }>`
    select count(*) as n from instagram_post
    where requested_by = ${INSTAGRAM_AUTO_REQUESTER} and created_at >= date_trunc('day', now(), 'UTC')
      and status <> ${S.failed}
  `.execute(db)
  return Number(rows[0]?.n ?? 0)
}

/**
 * Newly rendered reels with no live Instagram post, newest first, with their served render. A reel
 * whose earlier posts failed is retried (up to INSTAGRAM_AUTO_MAX_ATTEMPTS failures), except while a
 * lost upload is still being looked up on the account.
 */
export async function listAutoPostCandidates(
  db: Database,
  limit: number,
  lookbackHours = INSTAGRAM_AUTO_LOOKBACK_HOURS,
): Promise<AutoCandidate[]> {
  if (limit <= 0) return []
  const { rows } = await sql<AutoCandidate>`
    select i.id, i.title, i.tldr, i.topics, i.canonical_url, i.script ->> 'hook' as hook,
      served.video_key, served.credits
    from item i
    join lateral (
      select r.video_key, r.credits from render r
      where r.item_id = i.id and r.status = 'done' and r.video_key is not null
      order by ${sql.raw(SERVED_RENDER_ORDER_SQL)} limit 1
    ) served on true
    join lateral (
      select min(r.finished_at) as at from render r where r.item_id = i.id and r.status = 'done'
    ) first_done on true
    where i.status = 'rendered'
      and i.visibility = 'public'
      and first_done.at > now() - make_interval(hours => ${lookbackHours})
      and not exists (
        select 1 from instagram_post p where p.item_id = i.id
          and (p.status <> ${S.failed} or p.error in (${INSTAGRAM_LOST_ERROR}, ${LEGACY_LOST_ERROR}))
      )
      and (
        select count(*) from instagram_post p where p.item_id = i.id and p.status = ${S.failed}
      ) < ${INSTAGRAM_AUTO_MAX_ATTEMPTS}
    order by first_done.at desc
    limit ${limit}
  `.execute(db)
  return rows
}

/** Queues one auto post; false when the item already has a live post (unique index). */
export async function insertAutoPost(
  db: Database,
  post: { itemId: string; videoKey: string; caption: string },
): Promise<boolean> {
  try {
    await db
      .insertInto('instagram_post')
      .values({
        item_id: post.itemId,
        video_key: post.videoKey,
        caption: post.caption,
        status: InstagramPostStatus.queued,
        requested_by: INSTAGRAM_AUTO_REQUESTER,
      })
      .execute()
    return true
  } catch (err) {
    if ((err as { code?: string }).code === UNIQUE_VIOLATION) return false
    throw err
  }
}

export async function getStatsSyncedAt(db: Database): Promise<Date | null> {
  const value = await getStringSetting(db, IG_STATS_SYNCED_KEY)
  const at = value ? new Date(value) : null
  return at && !Number.isNaN(at.getTime()) ? at : null
}

export const setStatsSyncedAt = (db: Database, at: Date) =>
  putSetting(db, IG_STATS_SYNCED_KEY, at.toISOString())

export type PostForStats = {
  id: string
  media_pk: string | null
  permalink: string | null
  /** Posted through the official API, so `media_pk` is the Graph media id. */
  official: boolean
  posted_at: Date | null
  insights_at: Date | null
}

const asDate = (value: unknown) => (value ? new Date(value as Date) : null)

/** Every live post, for matching against the account's media list. */
export async function listPostsForStats(db: Database): Promise<PostForStats[]> {
  const rows = await db
    .selectFrom('instagram_post')
    .select(['id', 'media_pk', 'permalink', 'container_id', 'posted_at', 'insights_at'])
    .where('status', 'in', [S.posted, S.deleting])
    .orderBy('posted_at', 'desc')
    .execute()
  return rows.map((r) => ({
    id: r.id,
    media_pk: r.media_pk,
    permalink: r.permalink,
    official: r.container_id !== null,
    posted_at: asDate(r.posted_at),
    insights_at: asDate(r.insights_at),
  }))
}

// A count Instagram did not send (hidden likes, missing permission) keeps its last stored value.
const kept = (value: number | null | undefined) => value ?? undefined

export async function setPostStats(
  db: Database,
  id: string,
  stats: { likes: number | null; comments: number | null },
): Promise<void> {
  await db
    .updateTable('instagram_post')
    .set({
      like_count: kept(stats.likes),
      comments_count: kept(stats.comments),
      stats_at: sql`now()`,
    })
    .where('id', '=', id)
    .execute()
}

export type PostInsights = {
  views: number | null
  reach: number | null
  saves: number | null
  shares: number | null
}

/** Also stamps `insights_at` when there is nothing to store, so the post goes to the back of the line. */
export async function setPostInsights(
  db: Database,
  id: string,
  insights: PostInsights | null,
): Promise<void> {
  await db
    .updateTable('instagram_post')
    .set({
      view_count: kept(insights?.views),
      reach: kept(insights?.reach),
      saves: kept(insights?.saves),
      shares: kept(insights?.shares),
      insights_at: sql`now()`,
    })
    .where('id', '=', id)
    .execute()
}

export const INSTAGRAM_PERFORMANCE_SINCE_DAYS = 60
// Younger posts have not collected their numbers yet.
export const INSTAGRAM_PERFORMANCE_MIN_AGE_HOURS = 48

export type InstagramPerformance = {
  itemId: string
  title: string
  source: string
  postedAt: Date
  likes: number | null
  comments: number | null
  views: number | null
  shares: number | null
  saves: number | null
}

const sourceNames = sql.raw(
  Object.values(Source)
    .map((s) => `'${s}'`)
    .join(', '),
)

// Same rule as the gate's stats: the item's top-scored mention, else its canonical key prefix.
const performanceSource = sql<string>`coalesce(
  (select m.source::text from mention m where m.item_id = i.id order by m.score desc nulls last limit 1),
  case when split_part(i.canonical_key, ':', 1) in (${sourceNames})
    then split_part(i.canonical_key, ':', 1) else 'unknown' end
)`

/** Posted reels that have synced Instagram numbers, newest first. */
export async function listInstagramPerformance(
  db: Database,
  opts: { sinceDays?: number; minAgeHours?: number } = {},
): Promise<InstagramPerformance[]> {
  const sinceDays = opts.sinceDays ?? INSTAGRAM_PERFORMANCE_SINCE_DAYS
  const minAgeHours = opts.minAgeHours ?? INSTAGRAM_PERFORMANCE_MIN_AGE_HOURS
  const { rows } = await sql<{
    item_id: string
    title: string
    source: string
    posted_at: Date
    like_count: number | null
    comments_count: number | null
    view_count: number | null
    shares: number | null
    saves: number | null
  }>`
    select p.item_id, i.title, ${performanceSource} as source, p.posted_at,
      p.like_count, p.comments_count, p.view_count, p.shares, p.saves
    from instagram_post p
    join item i on i.id = p.item_id
    where p.status = ${S.posted}
      and p.stats_at is not null
      and p.posted_at >= now() - make_interval(days => ${sinceDays})
      and p.posted_at <= now() - make_interval(hours => ${minAgeHours})
    order by p.posted_at desc
  `.execute(db)
  return rows.map((r) => ({
    itemId: r.item_id,
    title: r.title,
    source: r.source,
    postedAt: new Date(r.posted_at),
    likes: r.like_count,
    comments: r.comments_count,
    views: r.view_count,
    shares: r.shares,
    saves: r.saves,
  }))
}
