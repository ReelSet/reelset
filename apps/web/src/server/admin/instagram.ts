import {
  InstagramPostStatus,
  RenderStatus,
  Source,
  assertPostTransition,
  getIgAccount,
  getIgCheckError,
  type Database,
  type Logger,
} from '@reelset/core'
import { sql } from 'kysely'
import {
  buildCaption,
  credits as creditsParser,
  validateQueueRequest,
} from '@/lib/instagram/caption'
import type { CommandResult } from '@/server/admin/commands'

export const REELS_PAGE_SIZE = 24
export const QUEUE_LIMIT = 40
const UNIQUE_VIOLATION = '23505'
const STALE_PREVIEW_MESSAGE =
  'This reel was re-rendered after you opened it. Reload and check the preview, then queue again.'

const itemSource = sql<string>`coalesce(
  (select m.source::text from mention m where m.item_id = item.id order by m.score desc nulls last limit 1),
  case when split_part(item.canonical_key, ':', 1) in (${sql.raw(
    Object.values(Source)
      .map((s) => `'${s}'`)
      .join(', '),
  )}) then split_part(item.canonical_key, ':', 1) else 'unknown' end
)`

const livePost = (column: string) =>
  sql`(select p.${sql.raw(column)} from instagram_post p where p.item_id = item.id
    and p.status in ('queued', 'posting', 'posted', 'deleting') order by p.created_at desc limit 1)`

export async function livePostPermalink(db: Database, itemId: string): Promise<string | null> {
  const row = await db
    .selectFrom('instagram_post')
    .select('permalink')
    .where('item_id', '=', itemId)
    .where('status', '=', InstagramPostStatus.posted)
    .executeTakeFirst()
  return row?.permalink ?? null
}

// Same render the feed serves (lib/ranking/sql.ts), so preview, post and app all show one reel.
const SERVED_RENDER_ORDER = sql.raw(
  'coalesce(r.template_version, 0) desc, r.finished_at desc nulls last, r.created_at desc, r.id desc',
)

const latestDone = (column: string) =>
  sql`(select r.${sql.raw(column)} from render r where r.item_id = item.id
    and r.status = 'done' and r.video_key is not null order by ${SERVED_RENDER_ORDER} limit 1)`

// The render a queue request posts: the item's served render, only while the item is rendered.
export function servedRenderQuery(db: Database, itemId: string) {
  return db
    .selectFrom('render as r')
    .innerJoin('item', 'item.id', 'r.item_id')
    .select('r.video_key')
    .where('r.item_id', '=', itemId)
    .where('r.status', '=', RenderStatus.done)
    .where('r.video_key', 'is not', null)
    .where('item.status', '=', 'rendered')
    .orderBy(SERVED_RENDER_ORDER)
    .limit(1)
}

export async function publishedReels(db: Database, offset: number) {
  const rows = await db
    .selectFrom('item')
    .select([
      'item.id',
      'item.title',
      'item.rendered_at',
      itemSource.as('source'),
      sql<string | null>`${latestDone('poster_key')}`.as('poster_key'),
      sql<string | null>`${livePost('status')}`.as('post_status'),
      sql<string | null>`${livePost('permalink')}`.as('permalink'),
    ])
    .where('item.status', '=', 'rendered')
    .where(sql<boolean>`${latestDone('video_key')} is not null`)
    .orderBy('item.rendered_at', 'desc')
    .orderBy('item.id')
    .limit(REELS_PAGE_SIZE + 1)
    .offset(offset)
    .execute()
  return { rows: rows.slice(0, REELS_PAGE_SIZE), hasMore: rows.length > REELS_PAGE_SIZE }
}

export async function composerReel(db: Database, itemId: string) {
  const row = await db
    .selectFrom('item')
    .select([
      'item.id',
      'item.title',
      'item.tldr',
      'item.topics',
      'item.canonical_url',
      sql<string | null>`item.script ->> 'hook'`.as('hook'),
      itemSource.as('source'),
      sql<string | null>`${latestDone('video_key')}`.as('video_key'),
      sql<string | null>`${latestDone('poster_key')}`.as('poster_key'),
      sql<unknown>`${latestDone('credits')}`.as('credits'),
      sql<string | null>`${livePost('status')}`.as('post_status'),
      sql<string | null>`${livePost('permalink')}`.as('permalink'),
    ])
    .where('item.id', '=', itemId)
    .where('item.status', '=', 'rendered')
    .executeTakeFirst()
  if (!row?.video_key) return null
  const draft = buildCaption({
    title: row.title,
    hook: row.hook,
    tldr: row.tldr,
    canonicalUrl: row.canonical_url,
    topics: row.topics,
    credits: creditsParser.parse(row.credits),
  })
  return { ...row, video_key: row.video_key, draftCaption: draft }
}

export async function postQueue(db: Database) {
  return db
    .selectFrom('instagram_post')
    .innerJoin('item', 'item.id', 'instagram_post.item_id')
    .select([
      'instagram_post.id',
      'instagram_post.item_id',
      'item.title',
      'instagram_post.status',
      'instagram_post.permalink',
      'instagram_post.error',
      'instagram_post.attempts',
      'instagram_post.created_at',
      'instagram_post.started_at',
      'instagram_post.posted_at',
      'instagram_post.delete_requested_at',
      sql<string | null>`(select r.poster_key from render r where r.item_id = instagram_post.item_id
        and r.video_key = instagram_post.video_key limit 1)`.as('poster_key'),
    ])
    .where('instagram_post.status', '!=', InstagramPostStatus.deleted)
    .orderBy('instagram_post.created_at', 'desc')
    .limit(QUEUE_LIMIT)
    .execute()
}

export async function lastPostedAt(db: Database): Promise<Date | null> {
  const row = await db
    .selectFrom('instagram_post')
    .select(sql<Date | null>`max(posted_at)`.as('at'))
    .executeTakeFirst()
  return row?.at ?? null
}

export const readAccount = (db: Database) => getIgAccount(db)
export const readCheckError = (db: Database) => getIgCheckError(db)

export async function queueInstagramPost(
  db: Database,
  input: { itemId: unknown; videoKey: unknown; caption: unknown; adminId: string },
  log: Logger,
): Promise<CommandResult> {
  const valid = validateQueueRequest({
    itemId: input.itemId,
    videoKey: input.videoKey,
    caption: input.caption,
  })
  if (!valid.ok) return { ok: false, message: valid.message }
  const l = log.child({ fn: 'queueInstagramPost', itemId: valid.itemId })

  const render = await servedRenderQuery(db, valid.itemId).executeTakeFirst()
  if (!render?.video_key) return { ok: false, message: 'This item has no finished reel to post' }
  if (render.video_key !== valid.videoKey) {
    l.warn({ previewed: valid.videoKey, served: render.video_key }, 'preview is stale, not queued')
    return { ok: false, message: STALE_PREVIEW_MESSAGE }
  }

  try {
    const row = await db
      .insertInto('instagram_post')
      .values({
        item_id: valid.itemId,
        video_key: render.video_key,
        caption: valid.caption,
        status: InstagramPostStatus.queued,
        requested_by: input.adminId,
      })
      .returning('id')
      .executeTakeFirstOrThrow()
    l.info({ postId: row.id }, 'instagram post queued')
    return {
      ok: true,
      message:
        'Queued. It posts within about 5 minutes, at least 10 minutes after the previous post.',
    }
  } catch (err) {
    if ((err as { code?: string }).code === UNIQUE_VIOLATION) {
      return { ok: false, message: 'This reel is already queued or posted' }
    }
    throw err
  }
}

export async function cancelQueuedPost(
  db: Database,
  input: { postId: string },
  log: Logger,
): Promise<CommandResult> {
  assertPostTransition(InstagramPostStatus.queued, InstagramPostStatus.deleted)
  const res = await db
    .updateTable('instagram_post')
    .set({ status: InstagramPostStatus.deleted, updated_at: sql`now()` })
    .where('id', '=', input.postId)
    .where('status', '=', InstagramPostStatus.queued)
    .executeTakeFirst()
  if (Number(res.numUpdatedRows) === 0) {
    return { ok: false, message: 'Too late to cancel: this post already started' }
  }
  log.info({ postId: input.postId }, 'queued instagram post cancelled')
  return { ok: true, message: 'Post cancelled' }
}

export async function requestPostDelete(
  db: Database,
  input: { postId: string },
  log: Logger,
): Promise<CommandResult> {
  const res = await db
    .updateTable('instagram_post')
    .set({ delete_requested_at: sql`now()`, updated_at: sql`now()` })
    .where('id', '=', input.postId)
    .where('status', '=', InstagramPostStatus.posted)
    .where('delete_requested_at', 'is', null)
    .executeTakeFirst()
  if (Number(res.numUpdatedRows) === 0) {
    return { ok: false, message: 'Only a posted reel can be deleted, once' }
  }
  log.info({ postId: input.postId }, 'instagram delete requested')
  return {
    ok: true,
    message: 'Delete queued. It is removed from Instagram within about 5 minutes.',
  }
}
