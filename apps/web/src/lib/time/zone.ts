export const TZ_COOKIE = 'tz'
export const DEFAULT_TIME_ZONE = 'UTC'

export function parseTimeZone(value: string | null | undefined): string | null {
  if (!value || value.length > 64) return null
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: value }).resolvedOptions().timeZone
  } catch {
    return null
  }
}

export type TimeStyle = 'datetime' | 'datetime-seconds' | 'date' | 'time' | 'day' | 'month-year'

const OPTIONS: Record<TimeStyle, Intl.DateTimeFormatOptions> = {
  datetime: { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false },
  'datetime-seconds': {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  },
  date: { day: 'numeric', month: 'short', year: 'numeric' },
  time: { hour: '2-digit', minute: '2-digit', hour12: false },
  day: { day: 'numeric', month: 'short' },
  'month-year': { month: 'long', year: 'numeric' },
}

const cache = new Map<string, Intl.DateTimeFormat>()

function formatter(timeZone: string, style: TimeStyle): Intl.DateTimeFormat {
  const key = `${timeZone}|${style}`
  let f = cache.get(key)
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', { ...OPTIONS[style], timeZone })
    cache.set(key, f)
  }
  return f
}

export function toDate(value: Date | string | number | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Formats an instant in the viewer's time zone, e.g. "15 Nov, 16:33". */
export function formatInZone(
  value: Date | string | number | null | undefined,
  timeZone: string,
  style: TimeStyle = 'datetime',
): string {
  const d = toDate(value)
  if (!d) return '-'
  return formatter(parseTimeZone(timeZone) ?? DEFAULT_TIME_ZONE, style).format(d)
}

/** Calendar day (YYYY-MM-DD) of an instant in a time zone, for bucketing charts. */
export function dayKeyInZone(value: Date | string | number, timeZone: string): string {
  const d = toDate(value)
  if (!d) return ''
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: parseTimeZone(timeZone) ?? DEFAULT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

/** Short zone label for the viewer, e.g. "GMT+5:30". */
export function zoneLabel(timeZone: string, at: Date = new Date()): string {
  const tz = parseTimeZone(timeZone) ?? DEFAULT_TIME_ZONE
  const part = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' })
    .formatToParts(at)
    .find((p) => p.type === 'timeZoneName')
  return part?.value ?? tz
}

/** Subtle page-header note, e.g. "Times in GMT+5:30." */
export function zoneHint(timeZone: string, at: Date = new Date()): string {
  return `Times in ${zoneLabel(timeZone, at)}.`
}

/** The next 00:00 UTC after `now`, when the per-UTC-day caps reset. */
export function nextUtcMidnight(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))
}

/** Explains a UTC-day bucket in the viewer's clock, e.g. "Days are UTC days, resetting 05:30 your time." */
export function utcDayResetHint(timeZone: string, now: Date = new Date()): string {
  return `Days are UTC days, resetting at ${formatInZone(nextUtcMidnight(now), timeZone, 'time')} your time.`
}

/** The next 1st-of-month 00:00 UTC after `now`, when monthly credits reset. */
export function nextUtcMonthStart(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
}
