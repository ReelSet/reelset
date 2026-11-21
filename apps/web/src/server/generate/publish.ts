import {
  SETTINGS,
  getReelRequest,
  getSetting,
  requestPublish,
  withdrawPublish,
  type Database,
  type Logger,
  type PublishChange,
  type PublishRefusal,
} from '@reelset/core'
import { z } from 'zod'
import { buildPublishRequestEmail } from '@/lib/email/publish-request'
import { sendEmail } from '@/lib/email/resend'
import type { ApiError, ReelRequestDto } from '@/lib/generate/types'
import { expireReels } from '@/server/cache-revalidate'
import { toRequestDto, type Viewer } from './service'

export type PublishResult =
  | { ok: true; request: ReelRequestDto }
  | { ok: false; status: number; error: ApiError['error']; message: string }

const REFUSALS: Record<
  PublishRefusal,
  { status: number; error: ApiError['error']; message: string }
> = {
  not_found: { status: 404, error: 'not_found', message: 'Reel not found.' },
  not_ready: {
    status: 409,
    error: 'not_publishable',
    message: 'Only finished reels you made can be submitted to the feed.',
  },
  already_submitted: {
    status: 409,
    error: 'not_publishable',
    message: 'This reel is already in review or live in the feed.',
  },
  not_submitted: {
    status: 409,
    error: 'not_publishable',
    message: 'This reel is not in review or in the feed.',
  },
}

function refuse(reason: PublishRefusal): PublishResult {
  return { ok: false, ...REFUSALS[reason] }
}

async function ownedRequest(db: Database, viewer: Viewer, requestId: string) {
  if (!z.guid().safeParse(requestId).success) return null
  const row = await getReelRequest(db, requestId)
  if (!row || row.user_id !== viewer.id || !row.item_id) return null
  return { row, itemId: row.item_id }
}

async function ownerLabel(db: Database, viewer: Viewer): Promise<string> {
  if (viewer.email) return viewer.email
  const profile = await db
    .selectFrom('profile')
    .select('display_name')
    .where('id', '=', viewer.id)
    .executeTakeFirst()
  return profile?.display_name ?? viewer.id.slice(0, 8)
}

async function emailAdmin(db: Database, viewer: Viewer, request: ReelRequestDto, log: Logger) {
  const [adminEmail, owner] = await Promise.all([
    getSetting(db, SETTINGS.adminEmail, log),
    ownerLabel(db, viewer),
  ])
  const sent = await sendEmail(
    buildPublishRequestEmail({
      adminEmail,
      ownerLabel: owner,
      title: request.reel?.title ?? 'Untitled reel',
      reelUrl: request.reel?.pageUrl ?? null,
    }),
    log,
  )
  log.info({ emailed: sent.ok }, 'feed submission email')
}

async function applyChange(
  db: Database,
  input: { viewer: Viewer; requestId: string },
  change: (itemId: string) => Promise<PublishChange>,
  log: Logger,
): Promise<{ result: PublishResult; request: ReelRequestDto | null }> {
  const owned = await ownedRequest(db, input.viewer, input.requestId)
  if (!owned) return { result: refuse('not_found'), request: null }
  const changed = await change(owned.itemId)
  if (!changed.ok) return { result: refuse(changed.reason), request: null }
  const request = await toRequestDto(db, owned.row)
  log.info({ requestId: owned.row.id, itemId: owned.itemId }, 'publish state changed')
  expireReels([owned.itemId], log)
  return { result: { ok: true, request }, request }
}

/** Owner submits a finished private reel for review; emails the admin best-effort. */
export async function submitToFeed(
  db: Database,
  input: { viewer: Viewer; requestId: string },
  log: Logger,
): Promise<PublishResult> {
  const l = log.child({ fn: 'submitToFeed', userId: input.viewer.id, requestId: input.requestId })
  const { result, request } = await applyChange(
    db,
    input,
    (itemId) => requestPublish(db, { itemId, ownerId: input.viewer.id }, l),
    l,
  )
  if (request && !input.viewer.isAdmin) await emailAdmin(db, input.viewer, request, l)
  return result
}

/** Owner cancels a pending review or takes a published reel back to private. */
export async function withdrawFromFeed(
  db: Database,
  input: { viewer: Viewer; requestId: string },
  log: Logger,
): Promise<PublishResult> {
  const l = log.child({
    fn: 'withdrawFromFeed',
    userId: input.viewer.id,
    requestId: input.requestId,
  })
  const { result } = await applyChange(
    db,
    input,
    (itemId) => withdrawPublish(db, { itemId, ownerId: input.viewer.id }, l),
    l,
  )
  return result
}
