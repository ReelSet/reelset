import { escapeHtml, type EmailInput } from './resend'

export const ADMIN_UPGRADES_URL = 'https://admin.reelset.app/admin/generate#upgrades'

export type UpgradeEmailInput = {
  adminEmail: string
  userEmail: string
  userId: string
  usedCredits: number
  monthlyFree: number
  message: string | null
}

export function buildUpgradeRequestEmail(input: UpgradeEmailInput): EmailInput {
  const used = `${input.usedCredits} of ${input.monthlyFree} credits used this month`
  const message = input.message?.trim() || '(no message)'
  const subject = `Credit request from ${input.userEmail.replace(/[\r\n]+/g, ' ').slice(0, 120)}`
  const text = [
    `${input.userEmail} asked for more credits.`,
    used,
    '',
    message,
    '',
    `Grant or dismiss: ${ADMIN_UPGRADES_URL}`,
  ].join('\n')
  const html = `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.5">
<p><strong>${escapeHtml(input.userEmail)}</strong> asked for more credits.</p>
<p>${escapeHtml(used)}</p>
<blockquote style="margin:0;padding-left:12px;border-left:3px solid #ccc;white-space:pre-wrap">${escapeHtml(message)}</blockquote>
<p><a href="${ADMIN_UPGRADES_URL}">Grant or dismiss in admin</a></p>
</div>`
  return { to: input.adminEmail, subject, html, text }
}
