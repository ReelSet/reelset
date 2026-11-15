import {
  REEL_REQUEST_OPEN,
  countPendingPublish,
  errorFields,
  type Database,
  type Logger,
} from '@reelset/core'
import { sql, type RawBuilder } from 'kysely'
import { gateAwaitingReview } from './gate-queries'
import {
  buildPeriods,
  buildSeries,
  type DailyRow,
  type MetricKey,
  type MetricSeries,
  type Periods,
} from '@/lib/admin/stats'

export const FAILED_LOOKBACK_HOURS = 24

type QueryContext = { tz: string; firstDay: string }

type MetricSource = {
  from: RawBuilder<unknown>
  dayExpr: (ctx: QueryContext) => RawBuilder<string>
  since: (ctx: QueryContext) => RawBuilder<unknown>
  value: RawBuilder<unknown>
  where?: RawBuilder<unknown>
}

const localDay = (column: string) => (ctx: QueryContext) =>
  sql<string>`to_char(date_trunc('day', ${sql.ref(column)} at time zone ${ctx.tz}), 'YYYY-MM-DD')`

const localSince = (column: string) => (ctx: QueryContext) =>
  sql`${sql.ref(column)} >= (${ctx.firstDay}::date)::timestamp at time zone ${ctx.tz}`

const countOf = (table: string, column: string, where?: RawBuilder<unknown>): MetricSource => ({
  from: sql`${sql.table(table)}`,
  dayExpr: localDay(column),
  since: localSince(column),
  value: sql`count(*)`,
  where,
})

const SOURCES: Record<MetricKey, MetricSource> = {
  newUsers: countOf('profile', 'created_at'),
  activeUsers: {
    ...countOf('event', 'created_at', sql`profile_id is not null`),
    value: sql`count(distinct profile_id)`,
  },
  views: countOf('item_view', 'created_at'),
  interactions: {
    ...countOf('interaction', 'created_at'),
    from: sql`(select created_at from "like" union all select created_at from save) as interaction`,
  },
  asks: countOf('ask_query', 'created_at'),
  rendered: countOf('render', 'finished_at', sql`status = 'done'`),
  requests: countOf('reel_request', 'created_at'),
  spend: {
    from: sql`spend_ledger`,
    dayExpr: () => sql<string>`to_char(day, 'YYYY-MM-DD')`,
    since: (ctx) => sql`day >= ${ctx.firstDay}::date`,
    value: sql`coalesce(sum(cost_usd), 0)`,
  },
}

async function dailyRows(db: Database, source: MetricSource, ctx: QueryContext) {
  const filter = source.where ? sql`${source.since(ctx)} and ${source.where}` : source.since(ctx)
  const result = await sql<{ day: string; value: string | number }>`
    select ${source.dayExpr(ctx)} as day, ${source.value} as value
    from ${source.from}
    where ${filter}
    group by 1`.execute(db)
  return result.rows.map((r): DailyRow => ({ day: r.day, value: Number(r.value) }))
}

async function distinctActiveUsers(db: Database, ctx: QueryContext, periods: Periods) {
  const currentStart = periods.days[0]!
  const result = await sql<{ cur: string; prev: string }>`
    select
      count(distinct profile_id) filter (
        where created_at >= (${currentStart}::date)::timestamp at time zone ${ctx.tz}) as cur,
      count(distinct profile_id) filter (
        where created_at < (${currentStart}::date)::timestamp at time zone ${ctx.tz}) as prev
    from event
    where profile_id is not null
      and created_at >= (${ctx.firstDay}::date)::timestamp at time zone ${ctx.tz}`.execute(db)
  const row = result.rows[0]
  return { current: Number(row?.cur ?? 0), previous: Number(row?.prev ?? 0) }
}

export type Attention = {
  failedItems: number
  failedInstagramPosts: number
  openUpgradeRequests: number
  openReelRequests: number
  pendingFeedSubmissions: number
  gateAwaitingReview: number
}

// The gate table arrives with a later migration; until then its count reads as zero instead of failing every badge.
async function gateReviewBacklog(db: Database): Promise<number> {
  try {
    return await gateAwaitingReview(db)
  } catch {
    return 0
  }
}

export async function attentionCounts(db: Database): Promise<Attention> {
  const [items, instagram, upgrades, requests, submissions, gateReviews] = await Promise.all([
    db
      .selectFrom('item')
      .select(db.fn.countAll<string>().as('n'))
      .where('status', '=', 'failed')
      .where(
        'status_changed_at',
        '>',
        sql<Date>`now() - make_interval(hours => ${FAILED_LOOKBACK_HOURS})`,
      )
      .executeTakeFirst(),
    db
      .selectFrom('instagram_post')
      .select(db.fn.countAll<string>().as('n'))
      .where('status', '=', 'failed')
      .executeTakeFirst(),
    db
      .selectFrom('credit_upgrade_request')
      .select(db.fn.countAll<string>().as('n'))
      .where('status', '=', 'open')
      .executeTakeFirst(),
    db
      .selectFrom('reel_request')
      .select(db.fn.countAll<string>().as('n'))
      .where('status', 'in', [...REEL_REQUEST_OPEN])
      .executeTakeFirst(),
    countPendingPublish(db),
    gateReviewBacklog(db),
  ])
  return {
    failedItems: Number(items?.n ?? 0),
    failedInstagramPosts: Number(instagram?.n ?? 0),
    openUpgradeRequests: Number(upgrades?.n ?? 0),
    openReelRequests: Number(requests?.n ?? 0),
    pendingFeedSubmissions: submissions,
    gateAwaitingReview: gateReviews,
  }
}

export type OverviewStats = {
  range: number
  tz: string
  metrics: Record<MetricKey, MetricSeries>
  unavailable: MetricKey[]
  totalUsers: number
  attention: Attention
}

const EMPTY_ATTENTION: Attention = {
  failedItems: 0,
  failedInstagramPosts: 0,
  openUpgradeRequests: 0,
  openReelRequests: 0,
  pendingFeedSubmissions: 0,
  gateAwaitingReview: 0,
}

/** One grouped query per metric, run in parallel; a failing metric degrades to zeros and is listed in `unavailable`. */
export async function overviewStats(
  db: Database,
  log: Logger,
  opts: { days: number; tz: string; now?: Date },
): Promise<OverviewStats> {
  const l = log.child({ fn: 'overviewStats', range: opts.days })
  const periods = buildPeriods(opts.now ?? new Date(), opts.tz, opts.days)
  const ctx: QueryContext = { tz: opts.tz, firstDay: periods.prevDays[0]! }
  const unavailable: MetricKey[] = []

  async function guarded<T>(label: string, fallback: T, run: () => Promise<T>): Promise<T> {
    try {
      return await run()
    } catch (err) {
      l.error({ ...errorFields(err), metric: label }, 'stats query failed')
      if (label in SOURCES) unavailable.push(label as MetricKey)
      return fallback
    }
  }

  const keys = Object.keys(SOURCES) as MetricKey[]
  const [rowSets, activeTotals, totalUsers, attention] = await Promise.all([
    Promise.all(keys.map((k) => guarded<DailyRow[]>(k, [], () => dailyRows(db, SOURCES[k], ctx)))),
    guarded('activeTotals', null, () => distinctActiveUsers(db, ctx, periods)),
    guarded('totalUsers', 0, async () => {
      const row = await db
        .selectFrom('profile')
        .select(db.fn.countAll<string>().as('n'))
        .executeTakeFirst()
      return Number(row?.n ?? 0)
    }),
    guarded('attention', EMPTY_ATTENTION, () => attentionCounts(db)),
  ])

  const metrics = {} as Record<MetricKey, MetricSeries>
  keys.forEach((k, i) => {
    const totals = k === 'activeUsers' && activeTotals ? activeTotals : undefined
    metrics[k] = buildSeries(rowSets[i]!, periods, totals)
  })
  return { range: opts.days, tz: opts.tz, metrics, unavailable, totalUsers, attention }
}
