import {
  buildPeriods,
  buildSeries,
  pctChange,
  sum,
  zeroFill,
  type DailyRow,
  type MetricDisplay,
  type MetricSeries,
  type Periods,
} from '@/lib/admin/stats'
import { dayKeyInZone } from '@/lib/time/zone'

export type InsightRow = {
  id: string
  itemId: string
  title: string
  source: string
  permalink: string | null
  postedAt: Date
  views: number | null
  reach: number | null
  likes: number | null
  comments: number | null
  saves: number | null
  shares: number | null
}

export type IgMetricKey =
  'posts' | 'views' | 'reach' | 'likes' | 'comments' | 'saves' | 'shares' | 'engagement'

export type IgMetricMeta = MetricDisplay & { key: IgMetricKey }

export const IG_METRICS: readonly IgMetricMeta[] = [
  { key: 'views', label: 'Views', unit: 'count', tone: 'growth' },
  { key: 'reach', label: 'Reach', unit: 'count', tone: 'growth' },
  { key: 'engagement', label: 'Engagement rate', unit: 'percent', tone: 'growth' },
  { key: 'posts', label: 'Posts', unit: 'count', tone: 'neutral' },
  { key: 'likes', label: 'Likes', unit: 'count', tone: 'growth' },
  { key: 'comments', label: 'Comments', unit: 'count', tone: 'growth' },
  { key: 'saves', label: 'Saves', unit: 'count', tone: 'growth' },
  { key: 'shares', label: 'Shares', unit: 'count', tone: 'growth' },
]

export type TopReel = InsightRow & { rate: number | null }
export type SourceSlice = { source: string; posts: number; avgViews: number; rate: number | null }
export type HourSlice = { hour: number; posts: number; avgViews: number }
export type FunnelStep = { key: string; label: string; value: number; ofViews: number | null }

export type Insights = {
  metrics: Record<IgMetricKey, MetricSeries>
  topReels: TopReel[]
  bySource: SourceSlice[]
  byHour: HourSlice[]
  funnel: FunnelStep[]
  postsInRange: number
  syncedInRange: number
}

export const TOP_REELS_LIMIT = 8

const n = (v: number | null) => v ?? 0

export const interactionsOf = (r: InsightRow) =>
  n(r.likes) + n(r.comments) + n(r.saves) + n(r.shares)

/** Interactions per 100 views; null until a post has views, so unsynced reels never read as 0%. */
export function engagementRate(interactions: number, views: number): number | null {
  return views > 0 ? (interactions / views) * 100 : null
}

function ratioSeries(num: DailyRow[], den: DailyRow[], periods: Periods): MetricSeries {
  const ratio = (a: number, b: number) => (b > 0 ? (a / b) * 100 : 0)
  const cur = zeroFill(num, periods.days).map((v, i) => ratio(v, zeroFill(den, periods.days)[i]!))
  const prev = zeroFill(num, periods.prevDays).map((v, i) =>
    ratio(v, zeroFill(den, periods.prevDays)[i]!),
  )
  const total = ratio(sum(zeroFill(num, periods.days)), sum(zeroFill(den, periods.days)))
  const prevTotal = ratio(
    sum(zeroFill(num, periods.prevDays)),
    sum(zeroFill(den, periods.prevDays)),
  )
  return {
    points: periods.days.map((day, i) => ({
      day,
      value: cur[i]!,
      prevDay: periods.prevDays[i]!,
      prev: prev[i]!,
    })),
    total,
    prevTotal,
    deltaPct: pctChange(total, prevTotal),
  }
}

const hourInZone = (date: Date, tz: string): number => {
  const part = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: tz })
    .formatToParts(date)
    .find((p) => p.type === 'hour')
  return Number(part?.value ?? 0)
}

const average = (values: number[]) => (values.length ? sum(values) / values.length : 0)

/** Daily series by the day a reel was posted, plus the breakdowns for the current window. */
export function buildInsights(
  rows: readonly InsightRow[],
  opts: { now: Date; tz: string; days: number },
): Insights {
  const periods = buildPeriods(opts.now, opts.tz, opts.days)
  const dayOf = (r: InsightRow) => dayKeyInZone(r.postedAt, opts.tz)
  const daily = (pick: (r: InsightRow) => number): DailyRow[] =>
    rows.map((r) => ({ day: dayOf(r), value: pick(r) }))

  const views = daily((r) => n(r.views))
  const metrics: Record<IgMetricKey, MetricSeries> = {
    posts: buildSeries(
      daily(() => 1),
      periods,
    ),
    views: buildSeries(views, periods),
    reach: buildSeries(
      daily((r) => n(r.reach)),
      periods,
    ),
    likes: buildSeries(
      daily((r) => n(r.likes)),
      periods,
    ),
    comments: buildSeries(
      daily((r) => n(r.comments)),
      periods,
    ),
    saves: buildSeries(
      daily((r) => n(r.saves)),
      periods,
    ),
    shares: buildSeries(
      daily((r) => n(r.shares)),
      periods,
    ),
    engagement: ratioSeries(daily(interactionsOf), views, periods),
  }

  const current = new Set(periods.days)
  const inRange = rows.filter((r) => current.has(dayOf(r)))
  const synced = inRange.filter((r) => r.views !== null)

  const topReels = [...synced]
    .sort((a, b) => n(b.views) - n(a.views))
    .slice(0, TOP_REELS_LIMIT)
    .map((r) => ({ ...r, rate: engagementRate(interactionsOf(r), n(r.views)) }))

  const bySource = [...Map.groupBy(synced, (r) => r.source)]
    .map(([source, group]) => ({
      source,
      posts: group.length,
      avgViews: average(group.map((r) => n(r.views))),
      rate: engagementRate(sum(group.map(interactionsOf)), sum(group.map((r) => n(r.views)))),
    }))
    .sort((a, b) => b.avgViews - a.avgViews)

  const hourBuckets = Map.groupBy(synced, (r) => hourInZone(r.postedAt, opts.tz))
  const byHour = Array.from({ length: 24 }, (_, hour) => {
    const group = hourBuckets.get(hour) ?? []
    return { hour, posts: group.length, avgViews: average(group.map((r) => n(r.views))) }
  })

  const total = (pick: (r: InsightRow) => number | null) => sum(synced.map((r) => n(pick(r))))
  const totalViews = total((r) => r.views)
  const step = (key: string, label: string, value: number): FunnelStep => ({
    key,
    label,
    value,
    ofViews: key === 'views' ? null : engagementRate(value, totalViews),
  })
  const funnel = [
    step('views', 'Views', totalViews),
    step(
      'reach',
      'Reach',
      total((r) => r.reach),
    ),
    step(
      'likes',
      'Likes',
      total((r) => r.likes),
    ),
    step(
      'comments',
      'Comments',
      total((r) => r.comments),
    ),
    step(
      'saves',
      'Saves',
      total((r) => r.saves),
    ),
    step(
      'shares',
      'Shares',
      total((r) => r.shares),
    ),
  ]

  return {
    metrics,
    topReels,
    bySource,
    byHour,
    funnel,
    postsInRange: inRange.length,
    syncedInRange: synced.length,
  }
}
