import {
  SETTINGS,
  createUpgradeRequest,
  getOpenUpgradeRequest,
  getSetting,
  type Database,
  type Logger,
} from '@reelset/core'
import { buildUpgradeRequestEmail } from '@/lib/email/upgrade-request'
import { sendEmail } from '@/lib/email/resend'
import type { ApiError } from '@/lib/generate/types'
import { monthlyUsage, type Viewer } from './service'

export const UPGRADE_MESSAGE_MAX = 1000

export type UpgradeResult =
  | { ok: true; id: string; emailed: boolean }
  | { ok: false; status: number; error: ApiError['error']; message: string }

export async function requestMoreCredits(
  db: Database,
  input: { user: Viewer; message: unknown },
  log: Logger,
): Promise<UpgradeResult> {
  const l = log.child({ fn: 'requestMoreCredits', userId: input.user.id })
  const message =
    typeof input.message === 'string' ? input.message.trim().slice(0, UPGRADE_MESSAGE_MAX) : ''
  if (await getOpenUpgradeRequest(db, input.user.id)) {
    return {
      ok: false,
      status: 409,
      error: 'already_requested',
      message: 'You already have an open request. We will get back to you by email.',
    }
  }
  const email = input.user.email ?? 'unknown'
  const row = await createUpgradeRequest(db, {
    userId: input.user.id,
    email,
    message: message || null,
  })
  const [adminEmail, usage] = await Promise.all([
    getSetting(db, SETTINGS.adminEmail, l),
    monthlyUsage(db, input.user.id, l),
  ])
  const sent = await sendEmail(
    buildUpgradeRequestEmail({
      adminEmail,
      userEmail: email,
      userId: input.user.id,
      usedCredits: usage.used,
      monthlyFree: usage.monthlyFree,
      message: message || null,
    }),
    l,
  )
  l.info({ upgradeRequestId: row.id, emailed: sent.ok }, 'credit upgrade requested')
  return { ok: true, id: row.id, emailed: sent.ok }
}
