import { ADMIN_SUBMISSIONS_URL } from './admin-links'
import { escapeHtml, singleLine, type EmailInput } from './resend'

export type PublishRequestEmailInput = {
  adminEmail: string
  ownerLabel: string
  title: string
  reelUrl: string | null
}

export function buildPublishRequestEmail(input: PublishRequestEmailInput): EmailInput {
  const title = input.title.trim() || 'Untitled reel'
  const subject = `Feed submission: ${singleLine(title, 100)}`
  const text = [
    `${input.ownerLabel} submitted a reel to the public feed.`,
    `Title: ${title}`,
    input.reelUrl ? `Watch: ${input.reelUrl}` : null,
    '',
    `Approve or reject: ${ADMIN_SUBMISSIONS_URL}`,
  ]
    .filter((line): line is string => line !== null)
    .join('\n')
  const watch = input.reelUrl
    ? `<p><a href="${escapeHtml(input.reelUrl)}">Watch the reel</a></p>`
    : ''
  const html = `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.5">
<p><strong>${escapeHtml(input.ownerLabel)}</strong> submitted a reel to the public feed.</p>
<p>${escapeHtml(title)}</p>
${watch}
<p><a href="${ADMIN_SUBMISSIONS_URL}">Approve or reject in admin</a></p>
</div>`
  return { to: input.adminEmail, subject, html, text }
}
