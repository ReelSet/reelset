import { sql } from 'kysely'
import type { Database } from '../db/client'
import { errorFields, type Logger } from '../lib/logger'

export const ALERT_KEYS = [
  'no_item_rendered_3h',
  'render_failure_rate_high',
  'source_lag',
  'youtube_search_failing',
  'spend_cap_reached',
  'transcript_success_low',
  'dead_letter_growing',
  'llm_quota_exhausted',
] as const
export type AlertKey = (typeof ALERT_KEYS)[number]

export const ALERT_REPEAT_MINUTES = 60

export function shouldSendAlert(
  lastSentAt: Date | null,
  now: Date,
  repeatMinutes = ALERT_REPEAT_MINUTES,
) {
  if (!lastSentAt) return true
  return now.getTime() - lastSentAt.getTime() >= repeatMinutes * 60_000
}

export type AlertInput = {
  key: AlertKey
  message: string
  fields?: Record<string, string | number | boolean | null>
}

/**
 * Posts to a Slack/Discord-compatible webhook, at most once per key per hour. The last-sent time
 * lives in app_setting so the dedupe holds across Workers, Vercel and the admin panel.
 */
export async function sendAlert(
  db: Database,
  webhookUrl: string | undefined,
  input: AlertInput,
  log: Logger,
  fetchImpl: typeof fetch = fetch,
): Promise<'sent' | 'suppressed' | 'no_webhook' | 'failed'> {
  const l = log.child({ alert: input.key })
  l.error({ ...input.fields }, `ALERT ${input.message}`)

  const settingKey = `alert_last_sent:${input.key}`
  const row = await db
    .selectFrom('app_setting')
    .select('value')
    .where('key', '=', settingKey)
    .executeTakeFirst()
  const last = typeof row?.value === 'string' ? new Date(row.value) : null
  if (!shouldSendAlert(last && !Number.isNaN(last.getTime()) ? last : null, new Date())) {
    l.debug('alert suppressed (sent within the last hour)')
    return 'suppressed'
  }
  if (!webhookUrl) {
    l.warn('ALERT_WEBHOOK_URL not set; alert only logged')
    return 'no_webhook'
  }

  const details = Object.entries(input.fields ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join(' ')
  const text = `[reelset] ${input.message}${details ? ` (${details})` : ''}`
  try {
    const res = await fetchImpl(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, content: text }),
    })
    if (!res.ok) {
      l.error({ status: res.status }, 'alert webhook rejected')
      return 'failed'
    }
  } catch (err) {
    l.error(errorFields(err), 'alert webhook call failed')
    return 'failed'
  }

  await db
    .insertInto('app_setting')
    .values({ key: settingKey, value: JSON.stringify(new Date().toISOString()) })
    .onConflict((oc) =>
      oc.column('key').doUpdateSet({
        value: JSON.stringify(new Date().toISOString()),
        updated_at: sql`now()`,
      }),
    )
    .execute()
  l.info('alert sent')
  return 'sent'
}
