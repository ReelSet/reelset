import {
  EventName,
  GATE_LABELS,
  ItemStatus,
  gateStats,
  gateVerdictSchema,
  parseGateSignals,
  errorFields,
  type Database,
  type GateStats,
  type Logger,
} from '@reelset/core'
import { sql, type RawBuilder } from 'kysely'
import { z } from 'zod'
import {
  JUDGE_WAS_RIGHT_SQL,
  gateTrendPoints,
  toGateView,
  type GateFilters,
  type GateSortKey,
  type GateTrendPoint,
  type GateTrendRow,
} from '@/lib/admin/gate'
import type { JudgedDecision } from '@/lib/admin/gate-tuning'
import type { GateView } from '@/lib/admin/gate-view'
import { sliceWithMore, type PageRequest } from '@/lib/admin/pagination'
import type { SortState } from '@/lib/admin/sort'
import { dayKeysEndingAt } from '@/lib/admin/stats'
import { dayKeyInZone } from '@/lib/time/zone'
import { dirOf, itemSource } from './queries'

const DAY_MS = 86_400_000
export const GATE_TREND_MIN_DAYS = 7
const JUDGED_BY = ['model', 'explore']

const GATE_SORT: Record<GateSortKey, RawBuilder<unknown>> = {
  decided: sql.ref('gate_decision.created_at'),
  score: sql.ref('gate_decision.score'),
}

export type GateQueueRow = {
  gate: GateView
  title: string
  source: string
  itemStatus: string
}

/** One page of decisions (every judgement, re-judgements included) with the item each was made for. */
export async function listGateDecisions(
  db: Database,
  page: PageRequest,
  filters: GateFilters,
  sort: SortState<GateSortKey>,
): Promise<{ rows: GateQueueRow[]; hasMore: boolean }> {
  let query = db
    .selectFrom('gate_decision')
    .innerJoin('item', 'item.id', 'gate_decision.item_id')
    .selectAll('gate_decision')
    .select(['item.title', 'item.status as item_status', itemSource.as('source')])
  if (filters.review === 'pending') {
    query = query
      .where('gate_decision.label', 'is', null)
      .where('gate_decision.decided_by', '<>', 'admin')
  }
  if (filters.review === 'agreed') query = query.where('gate_decision.label', '=', 'agree')
  if (filters.review === 'disagreed') query = query.where('gate_decision.label', '=', 'disagree')
  if (filters.verdict) query = query.where('gate_decision.verdict', '=', filters.verdict)
  if (filters.decidedBy) query = query.where('gate_decision.decided_by', '=', filters.decidedBy)
  if (filters.source) query = query.where(sql<boolean>`${itemSource} = ${filters.source}`)
  if (filters.trigger) query = query.where('gate_decision.trigger', '=', filters.trigger)
  if (filters.q) query = query.where('item.title', 'ilike', `%${filters.q.replace(/[%_\\]/g, '')}%`)
  const rows = await query
    .orderBy(GATE_SORT[sort.key], dirOf(sort))
    .orderBy('gate_decision.id')
    .limit(page.pageSize + 1)
    .offset(page.offset)
    .execute()
  const sliced = sliceWithMore(rows, page.pageSize)
  return {
    hasMore: sliced.hasMore,
    rows: sliced.rows.flatMap((row) => {
      const gate = toGateView(row)
      if (!gate) return []
      return [
        {
          gate,
          title: row.title,
          source: row.source,
          itemStatus: row.item_status,
        },
      ]
    }),
  }
}

export type GateReviewCounts = {
  pending: number
  agreed: number
  disagreed: number
  all: number
  manual: number
}

/** Sizes of the review tabs over every decision, on-demand ones included (they are reviewable too), plus how many were on demand. */
export async function gateReviewCounts(db: Database): Promise<GateReviewCounts> {
  const row = await db
    .selectFrom('gate_decision')
    .select([
      sql<string>`count(*) filter (where label is null and decided_by <> 'admin')`.as('pending'),
      sql<string>`count(*) filter (where label = 'agree')`.as('agreed'),
      sql<string>`count(*) filter (where label = 'disagree')`.as('disagreed'),
      sql<string>`count(*)`.as('all'),
      sql<string>`count(*) filter (where trigger = 'manual')`.as('manual'),
    ])
    .executeTakeFirst()
  return {
    pending: Number(row?.pending ?? 0),
    agreed: Number(row?.agreed ?? 0),
    disagreed: Number(row?.disagreed ?? 0),
    all: Number(row?.all ?? 0),
    manual: Number(row?.manual ?? 0),
  }
}

/** Decisions no admin has reviewed yet; admin overrides never need a review. */
export async function gateAwaitingReview(db: Database): Promise<number> {
  const row = await db
    .selectFrom('gate_decision')
    .select(db.fn.countAll<string>().as('n'))
    .where('label', 'is', null)
    .where('decided_by', '<>', 'admin')
    .executeTakeFirst()
  return Number(row?.n ?? 0)
}

export type GateOutcome = { views: number; likes: number; avgWatchRatio: number | null }

/** How the reels among these items performed; items without a live reel are absent from the map. */
export async function gateOutcomes(
  db: Database,
  itemIds: readonly string[],
): Promise<Map<string, GateOutcome>> {
  const ids = [...new Set(itemIds)]
  if (ids.length === 0) return new Map()
  const rows = await db
    .selectFrom('item')
    .select([
      'item.id',
      'item.view_count',
      sql<string>`(select count(*) from "like" l where l.item_id = item.id)`.as('likes'),
      sql<number | null>`(select avg((e.meta->>'watchRatio')::float) from event e
        where e.item_id = item.id and e.name = ${EventName.reel_complete}::event_name
          and jsonb_typeof(e.meta->'watchRatio') = 'number')`.as('avg_watch_ratio'),
    ])
    .where('item.id', 'in', ids)
    .where('item.status', '=', ItemStatus.rendered)
    .execute()
  return new Map(
    rows.map((row) => [
      row.id,
      {
        views: row.view_count,
        likes: Number(row.likes),
        avgWatchRatio: row.avg_watch_ratio === null ? null : Number(row.avg_watch_ratio),
      },
    ]),
  )
}

export type GateSourceReview = {
  source: string
  decided: number
  reels: number
  labelled: number
  judgeRight: number
}

const judgeWasRight = sql.raw(JUDGE_WAS_RIGHT_SQL)

/** Per source: decisions, reel share and how often admin labels say the judge was right, counted the way core's gateStats does (explore rows inverted). */
export async function gateSourceReview(
  db: Database,
  opts: { since: Date },
): Promise<GateSourceReview[]> {
  const { rows } = await sql<Omit<GateSourceReview, 'judgeRight'> & { judge_right: number }>`
    select source,
      count(*)::int as decided,
      count(*) filter (where verdict = 'reel')::int as reels,
      count(label)::int as labelled,
      count(*) filter (where ${judgeWasRight})::int as judge_right
    from (
      select d.verdict, d.label, d.decided_by, ${itemSource} as source
      from gate_decision d
      join item on item.id = d.item_id
      where d.created_at >= ${opts.since} and d.trigger = 'auto'
    ) decided
    group by source
    order by decided desc, source
  `.execute(db)
  return rows.map((row) => ({
    source: row.source,
    decided: Number(row.decided),
    reels: Number(row.reels),
    labelled: Number(row.labelled),
    judgeRight: Number(row.judge_right),
  }))
}

export async function gateDailyTrend(
  db: Database,
  opts: { days: readonly string[]; tz: string },
): Promise<GateTrendPoint[]> {
  const firstDay = opts.days[0]
  if (!firstDay) return []
  const { rows } = await sql<GateTrendRow>`
    select to_char(date_trunc('day', created_at at time zone ${opts.tz}), 'YYYY-MM-DD') as day,
      verdict, count(*)::int as decisions
    from gate_decision
    where created_at >= (${firstDay}::date)::timestamp at time zone ${opts.tz} and trigger = 'auto'
    group by 1, 2
  `.execute(db)
  return gateTrendPoints(
    rows.map((row) => ({ ...row, decisions: Number(row.decisions) })),
    opts.days,
  )
}

export type GateOverview = {
  stats: GateStats
  counts: GateReviewCounts
  sources: GateSourceReview[]
  trend: GateTrendPoint[]
}

/** Everything above the review table, in parallel; throws when the gate table is missing so the page can say so. */
export async function gateOverview(
  db: Database,
  opts: { rangeDays: number; tz: string; now?: Date },
): Promise<GateOverview> {
  const now = opts.now ?? new Date()
  const since = new Date(now.getTime() - opts.rangeDays * DAY_MS)
  const days = dayKeysEndingAt(
    dayKeyInZone(now, opts.tz),
    Math.max(opts.rangeDays, GATE_TREND_MIN_DAYS),
  )
  const [stats, counts, sources, trend] = await Promise.all([
    gateStats(db, { since }),
    gateReviewCounts(db),
    gateSourceReview(db, { since }),
    gateDailyTrend(db, { days, tz: opts.tz }),
  ])
  return { stats, counts, sources, trend }
}

const labelSchema = z.enum(GATE_LABELS)

/** The newest pipeline judgements that carry model signals (on-demand checks of old reels are left out so they cannot skew tuning), for re-scoring under other settings without a model call. */
export async function recentJudgedDecisions(
  db: Database,
  opts: { limit: number; labelledOnly?: boolean },
): Promise<JudgedDecision[]> {
  let query = db
    .selectFrom('gate_decision')
    .innerJoin('item', 'item.id', 'gate_decision.item_id')
    .select([
      'gate_decision.signals',
      'gate_decision.score',
      'gate_decision.threshold',
      'gate_decision.verdict',
      'gate_decision.label',
      itemSource.as('source'),
    ])
    .where('gate_decision.decided_by', 'in', JUDGED_BY)
    .where('gate_decision.trigger', '=', 'auto')
    .where('gate_decision.score', 'is not', null)
  if (opts.labelledOnly) query = query.where('gate_decision.label', 'is not', null)
  const rows = await query
    .orderBy('gate_decision.created_at', 'desc')
    .orderBy('gate_decision.id')
    .limit(opts.limit)
    .execute()
  return rows.flatMap((row) => {
    const verdict = gateVerdictSchema.safeParse(row.verdict)
    if (!verdict.success) return []
    const label = labelSchema.safeParse(row.label)
    return [
      {
        signals: parseGateSignals(row.signals),
        score: row.score === null ? null : Number(row.score),
        threshold: Number(row.threshold),
        verdict: verdict.data,
        label: label.success ? label.data : null,
        source: row.source,
      },
    ]
  })
}

export type GateQueue = {
  overview: GateOverview
  rows: GateQueueRow[]
  hasMore: boolean
  outcomes: Map<string, GateOutcome>
}

/** The whole review page in one call, or null when the gate table cannot be read (not migrated yet), so the page degrades instead of failing. */
export async function loadGateQueue(
  db: Database,
  log: Logger,
  opts: {
    page: PageRequest
    filters: GateFilters
    sort: SortState<GateSortKey>
    rangeDays: number
    tz: string
  },
): Promise<GateQueue | null> {
  try {
    const [overview, list] = await Promise.all([
      gateOverview(db, { rangeDays: opts.rangeDays, tz: opts.tz }),
      listGateDecisions(db, opts.page, opts.filters, opts.sort),
    ])
    const outcomes = await gateOutcomes(
      db,
      list.rows.map((row) => row.gate.itemId),
    ).catch((err: unknown) => {
      log.warn(errorFields(err), 'gate outcomes unavailable')
      return new Map<string, GateOutcome>()
    })
    return { overview, rows: list.rows, hasMore: list.hasMore, outcomes }
  } catch (err) {
    log.error(errorFields(err), 'gate queue unavailable')
    return null
  }
}
