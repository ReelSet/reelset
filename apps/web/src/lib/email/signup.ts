import { formatInZone, zoneLabel } from '@/lib/time/zone'
import { ADMIN_URL } from './admin-links'
import { escapeHtml, singleLine, type EmailInput } from './resend'

export type SignupEmailInput = {
  adminEmail: string
  name: string
  email: string | null
  provider: string | null
  signedUpAt: Date
  profileId: string
  timeZone: string
}

/** Signup time in the admin's zone (the admin_time_zone setting), e.g. "17 Nov, 16:00 GMT+5:30". */
export function formatSignupTime(at: Date, timeZone: string): string {
  return `${formatInZone(at, timeZone, 'datetime')} ${zoneLabel(timeZone, at)}`
}

export function buildSignupEmail(input: SignupEmailInput): EmailInput {
  const rows: [string, string][] = [
    ['Name', input.name],
    ['Email', input.email ?? '(none)'],
    ['Provider', input.provider ?? 'unknown'],
    ['Signed up', formatSignupTime(input.signedUpAt, input.timeZone)],
    ['Profile id', input.profileId],
  ]
  const subject = `New signup: ${singleLine(input.email ?? input.name, 100)}`
  const text = [
    'A new user signed up to reelset.',
    ...rows.map(([label, value]) => `${label}: ${value}`),
    '',
    `Admin: ${ADMIN_URL}`,
  ].join('\n')
  const table = rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:2px 12px 2px 0;color:#666">${label}</td><td>${escapeHtml(value)}</td></tr>`,
    )
    .join('')
  const html = `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.5">
<p>A new user signed up to reelset.</p>
<table>${table}</table>
<p><a href="${ADMIN_URL}">Open admin</a></p>
</div>`
  return { to: input.adminEmail, subject, html, text }
}
