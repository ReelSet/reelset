import 'server-only'
import { cookies } from 'next/headers'
import { DEFAULT_TIME_ZONE, TZ_COOKIE, parseTimeZone } from '@/lib/time/zone'

/** The viewer's IANA time zone, from the cookie TimeZoneSync sets; UTC until the browser reports it. */
export async function viewerTimeZone(): Promise<string> {
  const jar = await cookies()
  return parseTimeZone(jar.get(TZ_COOKIE)?.value) ?? DEFAULT_TIME_ZONE
}
