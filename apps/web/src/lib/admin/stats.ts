import { dayKeyInZone, formatInZone } from '@/lib/time/zone'

export const RANGE_OPTIONS = [7, 30, 90] as const
export type RangeDays = (typeof RANGE_OPTIONS)[number]
export const DEFAULT_RANGE_DAYS: RangeDays = 30

export type MetricKey =
  'newUsers' | 'activeUsers' | 'views' | 'interactions' | 'asks' | 'rendered' | 'requests' | 'spend'

export type MetricUnit = 'count' | 'usd'

export type MetricMeta = {
  key: MetricKey
  label: string
  unit: MetricUnit
  tone: 'growth' | 'neutral'
}

export const METRICS: readonly MetricMeta[] = [
  { key: 'newUsers', label: 'New users', unit: 'count', tone: 'growth' },
  { key: 'activeUsers', label: 'Active users', unit: 'count', tone: 'growth' },
  { key: 'views', label: 'Reel views', unit: 'count', tone: 'growth' },
  { key: 'interactions', label: 'Likes + saves', unit: 'count', tone: 'growth' },
  { key: 'asks', label: 'Ask questions', unit: 'count', tone: 'growth' },
  { key: 'rendered', label: 'Reels rendered', unit: 'count', tone: 'growth' },
  { key: 'requests', label: 'Reel requests', unit: 'count', tone: 'growth' },
  { key: 'spend', label: 'Spend', unit: 'usd', tone: 'neutral' },
]

export type DailyRow = { day: string; value: number }

export type SeriesPoint = {
  day: string
  value: number
  prevDay: string
  prev: number
}

export type MetricSeries = {
  points: SeriesPoint[]
  total: number
  prevTotal: number
  deltaPct: number | null
}

export type Periods = { days: string[]; prevDays: string[] }

export function parseRange(value: string | string[] | undefined): RangeDays {
  const raw = Array.isArray(value) ? value[0] : value
  const match = /^(\d{1,3})d$/.exec(raw ?? '')
  const n = match ? Number(match[1]) : Number.NaN
  return RANGE_OPTIONS.find((r) => r === n) ?? DEFAULT_RANGE_DAYS
}

export const rangeParam = (days: RangeDays): string => `${days}d`

export function shiftDayKey(key: string, offsetDays: number): string {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, d! + offsetDays)).toISOString().slice(0, 10)
}

/** Oldest-to-newest calendar day keys ending at `endKey`, inclusive. */
export function dayKeysEndingAt(endKey: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => shiftDayKey(endKey, i - (count - 1)))
}

/** The current window (today in `tz` included) and the equal-length window before it. */
export function buildPeriods(now: Date, tz: string, count: number): Periods {
  const all = dayKeysEndingAt(dayKeyInZone(now, tz), count * 2)
  return { prevDays: all.slice(0, count), days: all.slice(count) }
}

export function zeroFill(rows: readonly DailyRow[], keys: readonly string[]): number[] {
  const byDay = new Map<string, number>()
  for (const r of rows) byDay.set(r.day, (byDay.get(r.day) ?? 0) + r.value)
  return keys.map((k) => byDay.get(k) ?? 0)
}

export function sum(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0)
}

/** Percent change vs the previous period; null when there is no prior data to compare to. */
export function pctChange(current: number, previous: number): number | null {
  if (!(previous > 0)) return null
  return ((current - previous) / previous) * 100
}

export function buildSeries(
  rows: readonly DailyRow[],
  periods: Periods,
  totals?: { current: number; previous: number },
): MetricSeries {
  const current = zeroFill(rows, periods.days)
  const previous = zeroFill(rows, periods.prevDays)
  const total = totals?.current ?? sum(current)
  const prevTotal = totals?.previous ?? sum(previous)
  return {
    points: periods.days.map((day, i) => ({
      day,
      value: current[i]!,
      prevDay: periods.prevDays[i]!,
      prev: previous[i]!,
    })),
    total,
    prevTotal,
    deltaPct: pctChange(total, prevTotal),
  }
}

export function formatMetricValue(value: number, unit: MetricUnit): string {
  if (unit === 'usd') return `$${value.toFixed(value < 1 ? 4 : 2)}`
  return Math.round(value).toLocaleString('en-US')
}

export function formatCompact(value: number, unit: MetricUnit): string {
  if (unit === 'usd')
    return `$${value >= 100 ? Math.round(value) : value.toFixed(value < 1 ? 2 : 1)}`
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(
    value,
  )
}

export function formatDelta(pct: number): string {
  const abs = Math.abs(pct)
  const text = abs >= 100 ? abs.toFixed(0) : abs.toFixed(1)
  return `${pct < 0 ? '-' : '+'}${text}%`
}

/** A day key is already a calendar day in the viewer's zone, so format it as UTC to avoid a shift. */
export function formatDayKey(key: string): string {
  return formatInZone(`${key}T00:00:00Z`, 'UTC', 'day')
}
