import { errorFields, type Logger } from '@reelset/core'

export type EmailInput = { to: string; subject: string; html: string; text: string }
export type EmailResult = { ok: true; id: string | null } | { ok: false }

const RESEND_URL = 'https://api.resend.com/emails'
export const EMAIL_FROM = 'reelset <notifications@reelset.app>'

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Collapses line breaks so user text cannot inject headers into a subject. */
export function singleLine(text: string, max = 120): string {
  return text.replace(/[\r\n]+/g, ' ').slice(0, max)
}

export async function sendEmail(input: EmailInput, log: Logger): Promise<EmailResult> {
  const key = process.env.RESEND_API_KEY
  if (!key) {
    log.warn({ subject: input.subject }, 'RESEND_API_KEY missing, email not sent')
    return { ok: false }
  }
  try {
    const res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text,
      }),
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) {
      log.warn({ status: res.status }, 'resend rejected email')
      return { ok: false }
    }
    const body = (await res.json().catch(() => null)) as { id?: string } | null
    log.info({ emailId: body?.id }, 'email sent')
    return { ok: true, id: body?.id ?? null }
  } catch (err) {
    log.warn(errorFields(err), 'email send failed')
    return { ok: false }
  }
}
