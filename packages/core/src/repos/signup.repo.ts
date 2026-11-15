import { sql } from 'kysely'
import type { Database } from '../db/client'
import type { Logger } from '../lib/logger'

export const SIGNUP_NOTIFY_WINDOW_MINUTES = 15

export type ClaimedSignup = { createdAt: Date }

/** Atomically marks a fresh profile as notified; only the one caller that gets a row may send the email. */
export async function claimSignupNotification(
  db: Database,
  profileId: string,
  log: Logger,
  windowMinutes: number = SIGNUP_NOTIFY_WINDOW_MINUTES,
): Promise<ClaimedSignup | null> {
  const row = await db
    .updateTable('profile')
    .set({ signup_notified_at: sql`now()` })
    .where('id', '=', profileId)
    .where('signup_notified_at', 'is', null)
    .where('created_at', '>', sql<Date>`now() - make_interval(mins => ${windowMinutes})`)
    .returning('created_at')
    .executeTakeFirst()
  if (!row) return null
  log.info({ profileId }, 'signup notification claimed')
  return { createdAt: new Date(row.created_at) }
}
