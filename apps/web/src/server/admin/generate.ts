import {
  getReelRequest,
  resolveUpgradeRequest,
  setReelRequestResult,
  type Database,
  type Logger,
} from '@reelset/core'
import { sql } from 'kysely'
import { z } from 'zod'
import type { CommandResult } from '@/server/admin/commands'
import { retryItem } from '@/server/admin/commands'
import { kickIngest } from '@/server/generate/kick'
import { createGenerateRequest } from '@/server/generate/service'

export const GRANT_MAX = 100_000
export const grantSchema = z.coerce.number().int().min(1).max(GRANT_MAX)

export function parseUrlLines(raw: unknown): string[] {
  if (typeof raw !== 'string') return []
  return raw
    .split(/[\s,]+/)
    .map((u) => u.trim())
    .filter(Boolean)
}

export async function adminGenerate(
  db: Database,
  input: { adminId: string; urls: unknown },
  log: Logger,
): Promise<CommandResult> {
  const result = await createGenerateRequest(
    db,
    {
      user: { id: input.adminId, email: null, isAdmin: true },
      urls: parseUrlLines(input.urls),
      via: 'admin',
    },
    log,
  )
  if (!result.ok) return { ok: false, message: result.message }
  return { ok: true, message: `Request ${result.request.id.slice(0, 8)} queued` }
}

export async function setItemVisibility(
  db: Database,
  input: { itemId: string; visibility: 'public' | 'private' },
  log: Logger,
): Promise<CommandResult> {
  const res = await db
    .updateTable('item')
    .set({ visibility: input.visibility })
    .where('id', '=', input.itemId)
    .where('owner_id', 'is not', null)
    .executeTakeFirst()
  if (Number(res.numUpdatedRows) === 0) {
    return { ok: false, message: 'Only requested reels can change visibility' }
  }
  log.info({ itemId: input.itemId, visibility: input.visibility }, 'reel visibility changed')
  return {
    ok: true,
    message: input.visibility === 'public' ? 'Published to the feed' : 'Removed from the feed',
  }
}

/** Free retry: the user was already refunded for the failure, so nothing is charged again. */
export async function retryRequest(
  db: Database,
  input: { requestId: string; adminId: string },
  log: Logger,
): Promise<CommandResult> {
  const l = log.child({ fn: 'retryRequest', requestId: input.requestId })
  const row = await getReelRequest(db, input.requestId)
  if (!row || row.status !== 'failed') return { ok: false, message: 'Request is not failed' }

  if (!row.item_id) {
    await setReelRequestResult(db, row.id, { status: 'pending' }, ['failed'])
    await kickIngest(l)
    return { ok: true, message: 'Request re-queued' }
  }
  const retried = await retryItem(
    db,
    { itemId: row.item_id, stage: 'found', adminId: input.adminId },
    l,
  )
  if (!retried.ok) return retried
  await db
    .updateTable('item')
    .set({ priority_at: sql`now()` })
    .where('id', '=', row.item_id)
    .execute()
  await setReelRequestResult(db, row.id, { status: 'processing' }, ['failed'])
  l.info({ itemId: row.item_id }, 'request retried by admin')
  return { ok: true, message: 'Retrying, no extra credits charged' }
}

export async function grantUpgrade(
  db: Database,
  input: { id: string; credits: unknown },
  log: Logger,
): Promise<CommandResult> {
  const credits = grantSchema.safeParse(input.credits)
  if (!credits.success) return { ok: false, message: `Credits must be 1-${GRANT_MAX}` }
  const done = await resolveUpgradeRequest(
    db,
    input.id,
    { status: 'granted', credits: credits.data },
    log,
  )
  return done
    ? { ok: true, message: `Granted ${credits.data} credits` }
    : { ok: false, message: 'Request is no longer open' }
}

export async function dismissUpgrade(
  db: Database,
  input: { id: string },
  log: Logger,
): Promise<CommandResult> {
  const done = await resolveUpgradeRequest(db, input.id, { status: 'dismissed' }, log)
  return done
    ? { ok: true, message: 'Dismissed' }
    : { ok: false, message: 'Request is no longer open' }
}
