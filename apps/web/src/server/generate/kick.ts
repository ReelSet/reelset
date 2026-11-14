import { errorFields, type Logger } from '@reelset/core'

/** Best-effort nudge so the ingest worker picks the request up now; the 5-minute cron is the fallback. */
export async function kickIngest(log: Logger): Promise<boolean> {
  const base = process.env.INGEST_INTERNAL_URL
  const token = process.env.INGEST_INTERNAL_TOKEN
  if (!base || !token) {
    log.debug('ingest kick not configured, cron will pick the request up')
    return false
  }
  try {
    const res = await fetch(`${base.replace(/\/+$/, '')}/internal/generate/kick`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(3000),
    })
    if (!res.ok) log.warn({ status: res.status }, 'ingest kick rejected')
    return res.ok
  } catch (err) {
    log.warn(errorFields(err), 'ingest kick failed')
    return false
  }
}
