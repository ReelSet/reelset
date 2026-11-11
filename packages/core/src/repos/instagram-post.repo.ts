import { sql, type Selectable } from 'kysely'
import type { Database } from '../db/client'
import type { InstagramPost } from '../db/types'
import { InstagramPostStatus } from '../db/enums'
import {
  INSTAGRAM_MIN_GAP_MINUTES,
  INSTAGRAM_LOST_ERROR,
  INSTAGRAM_LOST_RECHECK_DAYS,
  INSTAGRAM_NOT_FOUND_ERROR,
  INSTAGRAM_POSTING_STUCK_MINUTES,
  assertPostTransition,
  igAccountSchema,
  type IgAccount,
} from '../domain/instagram-post'
import type { Logger } from '../lib/logger'

export const IG_ACCOUNT_KEY = 'ig_account'
export const IG_SESSION_KEY = 'ig_session_enc'
export const IG_CHECK_ERROR_KEY = 'ig_check_error'

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

// Written by failStuckPosts before the Instagram lookup existed.
const LEGACY_LOST_ERROR = 'No result recorded; check Instagram before queueing it again'

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
