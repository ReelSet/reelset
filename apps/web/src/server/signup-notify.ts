import {
  SETTINGS,
  claimSignupNotification,
  errorFields,
  getSetting,
  type Database,
  type Logger,
} from '@reelset/core'
import type { SignupInfo } from '@/lib/auth/signup-info'
import { buildSignupEmail } from '@/lib/email/signup'
import { sendEmail } from '@/lib/email/resend'

export type SignupNotifyOutcome = 'sent' | 'send_failed' | 'not_new' | 'disabled' | 'error'

/** Emails the admin once per new profile: the DB claim is the exactly-once gate; never throws. */
export async function notifyNewSignup(
  db: Database,
  info: SignupInfo,
  log: Logger,
): Promise<SignupNotifyOutcome> {
  const l = log.child({ fn: 'notifyNewSignup', profileId: info.profileId })
  try {
    const claimed = await claimSignupNotification(db, info.profileId, l)
    if (!claimed) return 'not_new'
    const [enabled, adminEmail, timeZone] = await Promise.all([
      getSetting(db, SETTINGS.notifySignups, l),
      getSetting(db, SETTINGS.adminEmail, l),
      getSetting(db, SETTINGS.adminTimeZone, l),
    ])
    if (!enabled) {
      l.info('signup notification skipped: disabled in settings')
      return 'disabled'
    }
    const sent = await sendEmail(
      buildSignupEmail({
        adminEmail,
        name: info.name,
        email: info.email,
        provider: info.provider,
        signedUpAt: claimed.createdAt,
        profileId: info.profileId,
        timeZone,
      }),
      l,
    )
    if (!sent.ok) l.warn('signup notification email failed')
    return sent.ok ? 'sent' : 'send_failed'
  } catch (err) {
    l.warn(errorFields(err), 'signup notification failed')
    return 'error'
  }
}
