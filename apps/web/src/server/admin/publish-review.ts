import {
  RenderStatus,
  publishNoteSchema,
  reviewPublish,
  type Database,
  type Logger,
  type PublishReview,
} from '@reelset/core'
import { sql } from 'kysely'
import type { CommandResult } from '@/server/admin/commands'
import { mediaUrl } from '@/lib/media'
import { reelPath } from '@/lib/reel-url'
import { absoluteUrl } from '@/lib/seo/site'

export const SUBMISSIONS_LIMIT = 30

export type FeedSubmission = {
  itemId: string
  title: string
  ownerLabel: string
  posterUrl: string | null
  pageUrl: string
  review: PublishReview
  requestedAt: Date
  reviewedAt: Date | null
  note: string | null
}

/** Pending submissions oldest first, then the most recently reviewed; hidden items never show. */
export async function listFeedSubmissions(
  db: Database,
  mediaBase: string,
  limit = SUBMISSIONS_LIMIT,
): Promise<FeedSubmission[]> {
  const rows = await db
    .selectFrom('item')
    .leftJoin('profile', 'profile.id', 'item.owner_id')
    .leftJoinLateral(
      (eb) =>
        eb
          .selectFrom('render')
          .select('render.poster_key')
          .whereRef('render.item_id', '=', 'item.id')
          .where('render.status', '=', RenderStatus.done)
          .where('render.video_key', 'is not', null)
          .orderBy('render.created_at', 'desc')
          .limit(1)
          .as('r'),
      (join) => join.onTrue(),
    )
    .select([
      'item.id',
      'item.title',
      'item.owner_id',
      'item.publish_review',
      'item.publish_requested_at',
      'item.publish_reviewed_at',
      'item.publish_note',
      'profile.display_name',
      'r.poster_key',
    ])
    .where('item.publish_review', 'is not', null)
    .where('item.publish_requested_at', 'is not', null)
    .where('item.visibility', '<>', 'hidden')
    .orderBy(sql`(item.publish_review = 'pending')`, 'desc')
    .orderBy(
      sql`case when item.publish_review = 'pending' then item.publish_requested_at end`,
      'asc',
    )
    .orderBy('item.publish_reviewed_at', 'desc')
    .limit(limit)
    .execute()
  return rows.map((row) => ({
    itemId: row.id,
    title: row.title,
    ownerLabel: row.display_name ?? row.owner_id?.slice(0, 8) ?? 'unknown',
    posterUrl: mediaUrl(mediaBase, row.poster_key),
    pageUrl: absoluteUrl(reelPath({ id: row.id, title: row.title })),
    review: row.publish_review as PublishReview,
    requestedAt: new Date(row.publish_requested_at as Date),
    reviewedAt: row.publish_reviewed_at ? new Date(row.publish_reviewed_at) : null,
    note: row.publish_note,
  }))
}

const NO_LONGER_PENDING = 'Submission is no longer pending'

export async function approveSubmission(
  db: Database,
  input: { itemId: string },
  log: Logger,
): Promise<CommandResult> {
  const applied = await reviewPublish(
    db,
    { itemId: input.itemId, decision: 'approve', note: null },
    log,
  )
  return applied
    ? { ok: true, message: 'Approved and published to the feed' }
    : { ok: false, message: NO_LONGER_PENDING }
}

export async function rejectSubmission(
  db: Database,
  input: { itemId: string; note: unknown },
  log: Logger,
): Promise<CommandResult> {
  const note = publishNoteSchema.safeParse(typeof input.note === 'string' ? input.note : '')
  if (!note.success) return { ok: false, message: 'Note must be 300 characters or fewer' }
  const applied = await reviewPublish(
    db,
    { itemId: input.itemId, decision: 'reject', note: note.data },
    log,
  )
  return applied
    ? { ok: true, message: 'Rejected, the owner can resubmit' }
    : { ok: false, message: NO_LONGER_PENDING }
}
