import { GATE_PROMPT_VERSION, createLogger } from '@reelset/core'
import type { CompiledQuery } from 'kysely'
import { describe, expect, it } from 'vitest'
import { DEFAULT_GATE_SORT, parseGateFilters, type GateFilters } from '@/lib/admin/gate'
import {
  gateAwaitingReview,
  gateOutcomes,
  gateOverview,
  gateReviewCounts,
  gateSourceReview,
  listGateDecisions,
  loadGateQueue,
  recentJudgedDecisions,
} from './gate-queries'
import { scriptedDb, sqlHas, type Scripted } from './scripted-db'

const log = createLogger({ app: 'test', level: 'silent' })
const NOW = new Date('2026-11-15T12:00:00Z')
const PAGE = { page: 3, pageSize: 2, offset: 4 }
const NO_FILTERS = parseGateFilters({ review: 'all' })

const decision = (n: number, patch: Record<string, unknown> = {}) => ({
  id: `d${n}`,
  item_id: `i${n}`,
  verdict: 'reel',
  score: 60 + n,
  threshold: 55,
  signals: { hook: 7 },
  reasons: ['clear demo'],
  rationale: '',
  decided_by: 'model',
  rule: null,
  mode: 'shadow',
  applied: false,
  trigger: 'auto',
  model: 'claude-haiku-5-5',
  prompt_version: 'gate-v1',
  config_hash: 'h',
  cost_usd: 0.001,
  label: null,
  label_reason: null,
  label_note: null,
  labeled_by: null,
  labeled_at: null,
  created_at: NOW,
  title: `Item ${n}`,
  item_status: 'rendered',
  source: 'github',
  ...patch,
})

async function listSql(filters: GateFilters, sort = DEFAULT_GATE_SORT) {
  const { db, queries } = scriptedDb(() => [])
  await listGateDecisions(db, PAGE, filters, sort)
  return queries[0]!
}

describe('listGateDecisions', () => {
  it('fetches one extra row to detect another page and maps rows for the table', async () => {
    const { db, queries } = scriptedDb(() => [decision(1), decision(2), decision(3)])
    const out = await listGateDecisions(db, PAGE, NO_FILTERS, DEFAULT_GATE_SORT)
    expect(out.hasMore).toBe(true)
    expect(out.rows).toHaveLength(2)
    expect(out.rows[0]).toMatchObject({
      title: 'Item 1',
      source: 'github',
      itemStatus: 'rendered',
      gate: { decisionId: 'd1', itemId: 'i1', verdict: 'reel', score: 61 },
    })
    expect(queries[0]!.parameters.slice(-2)).toEqual([3, 4])
  })

  it('skips a row with an unknown verdict instead of failing the page', async () => {
    const { db } = scriptedDb(() => [decision(1, { verdict: 'maybe' }), decision(2)])
    const out = await listGateDecisions(db, PAGE, NO_FILTERS, DEFAULT_GATE_SORT)
    expect(out.rows.map((row) => row.gate.decisionId)).toEqual(['d2'])
  })

  it('shows unlabelled, non-admin decisions in the review queue', async () => {
    const q = await listSql(parseGateFilters({}))
    expect(q.sql).toContain('"gate_decision"."label" is null')
    expect(q.sql).toContain('"gate_decision"."decided_by" <> $1')
    expect(q.parameters[0]).toBe('admin')
  })

  it('filters agreed and disagreed by label', async () => {
    expect((await listSql(parseGateFilters({ review: 'agreed' }))).parameters).toContain('agree')
    const disagreed = await listSql(parseGateFilters({ review: 'disagreed' }))
    expect(disagreed.parameters).toContain('disagree')
    expect(disagreed.sql).toContain('"gate_decision"."label" = $1')
  })

  it('applies verdict, decided-by and source as parameters and no review filter under All', async () => {
    const q = await listSql(
      parseGateFilters({ review: 'all', verdict: 'source_only', by: 'explore', source: 'papers' }),
    )
    expect(q.sql).not.toContain('"label"')
    expect(q.sql).toContain('"gate_decision"."verdict" = $')
    expect(q.sql).toContain('"gate_decision"."decided_by" = $')
    expect(q.parameters).toEqual(expect.arrayContaining(['source_only', 'explore', 'papers']))
  })

  it('keeps search text out of the SQL and strips wildcards', async () => {
    const q = await listSql({ ...NO_FILTERS, q: "50%_off'; drop table item; --" })
    expect(q.sql).not.toContain('drop table')
    expect(q.sql).toContain('ilike')
    expect(q.parameters).toContain("%50off'; drop table item; --%")
  })

  it('sorts by a whitelisted column with nulls last and a stable tiebreak', async () => {
    const newest = await listSql(NO_FILTERS)
    expect(newest.sql).toContain(
      'order by "gate_decision"."created_at" desc nulls last, "gate_decision"."id"',
    )
    const byScore = await listSql(NO_FILTERS, { key: 'score', dir: 'asc' })
    expect(byScore.sql).toContain('order by "gate_decision"."score" asc nulls last')
  })
})

describe('manual judgements', () => {
  it('lists manual rows with a tag unless a trigger filter is chosen', async () => {
    const { db } = scriptedDb(() => [decision(1, { trigger: 'manual' })])
    const out = await listGateDecisions(db, PAGE, NO_FILTERS, DEFAULT_GATE_SORT)
    expect(out.rows[0]?.gate).toMatchObject({ manual: true })
    expect((await listSql(NO_FILTERS)).sql).not.toContain('"trigger"')
    const manualOnly = await listSql(parseGateFilters({ review: 'all', trigger: 'manual' }))
    expect(manualOnly.sql).toContain('"gate_decision"."trigger" = $')
    expect(manualOnly.parameters).toContain('manual')
  })

  it('keeps manual rows out of the overview numbers, the trend and the tuning sample', async () => {
    const { db, queries } = scriptedDb(respondOverview)
    await gateOverview(db, { rangeDays: 7, tz: 'UTC', now: NOW })
    await recentJudgedDecisions(db, { limit: 10 })
    const stats = queries.find((q) => sqlHas(q, 'group by verdict, decided_by, source'))!
    expect(stats.sql).toContain('d.trigger = $')
    expect(stats.parameters).toContain('auto')
    expect(queries.find((q) => sqlHas(q, 'group by source'))!.sql).toContain("d.trigger = 'auto'")
    expect(queries.find((q) => sqlHas(q, 'date_trunc'))!.sql).toContain("trigger = 'auto'")
    const sample = queries.at(-1)!
    expect(sample.sql).toContain('"gate_decision"."trigger" = $')
    expect(sample.parameters).toContain('auto')
  })
})

describe('gate counts', () => {
  it('counts the review tabs in one query', async () => {
    const { db, queries } = scriptedDb(() => [
      { pending: '12', agreed: '5', disagreed: '2', all: '20', manual: '3' },
    ])
    expect(await gateReviewCounts(db)).toEqual({
      pending: 12,
      agreed: 5,
      disagreed: 2,
      all: 20,
      manual: 3,
    })
    expect(queries).toHaveLength(1)
  })

  it('reads zero from an empty table', async () => {
    const { db } = scriptedDb(() => [])
    expect(await gateReviewCounts(db)).toEqual({
      pending: 0,
      agreed: 0,
      disagreed: 0,
      all: 0,
      manual: 0,
    })
    expect(await gateAwaitingReview(db)).toBe(0)
  })

  it('leaves admin overrides out of the awaiting-review count', async () => {
    const { db, queries } = scriptedDb(() => [{ n: '9' }])
    expect(await gateAwaitingReview(db)).toBe(9)
    expect(queries[0]!.sql).toContain('"label" is null')
    expect(queries[0]!.parameters).toEqual(['admin'])
  })
})

describe('gateOutcomes', () => {
  it('asks only about live reels and skips the query for an empty page', async () => {
    const { db, queries } = scriptedDb(() => [
      { id: 'i1', view_count: 120, likes: '4', avg_watch_ratio: 0.62 },
      { id: 'i2', view_count: 0, likes: '0', avg_watch_ratio: null },
    ])
    expect(await gateOutcomes(db, [])).toEqual(new Map())
    expect(queries).toHaveLength(0)
    const outcomes = await gateOutcomes(db, ['i1', 'i2', 'i1'])
    expect(outcomes.get('i1')).toEqual({ views: 120, likes: 4, avgWatchRatio: 0.62 })
    expect(outcomes.get('i2')).toEqual({ views: 0, likes: 0, avgWatchRatio: null })
    expect(queries).toHaveLength(1)
    expect(queries[0]!.parameters).toEqual(expect.arrayContaining(['i1', 'i2', 'rendered']))
    expect(queries[0]!.parameters.filter((p) => p === 'i1')).toHaveLength(1)
  })
})

function respondOverview(q: CompiledQuery): Scripted {
  if (sqlHas(q, 'date_trunc')) {
    return [
      { day: '2026-11-15', verdict: 'reel', decisions: 4 },
      { day: '2026-11-15', verdict: 'source_only', decisions: 6 },
    ]
  }
  if (sqlHas(q, 'group by verdict, decided_by, source')) {
    return [
      {
        verdict: 'reel',
        decided_by: 'model',
        source: 'github',
        decisions: 4,
        labelled: 2,
        agreed: 1,
        cost_usd: 0.004,
      },
      {
        verdict: 'source_only',
        decided_by: 'rule',
        source: 'hn',
        decisions: 6,
        labelled: 0,
        agreed: 0,
        cost_usd: 0,
      },
    ]
  }
  if (sqlHas(q, 'group by source')) {
    return [{ source: 'hn', decided: '6', reels: '0', labelled: '4', judge_right: '3' }]
  }
  if (sqlHas(q, 'as "pending"')) return [{ pending: '8', agreed: '1', disagreed: '1', all: '10' }]
  if (sqlHas(q, 'from "item"')) return []
  return [decision(1)]
}

describe('gateOverview', () => {
  it('builds KPIs, per-source rows and a zero-filled trend of at least a week', async () => {
    const { db, queries } = scriptedDb(respondOverview)
    const out = await gateOverview(db, { rangeDays: 1, tz: 'Asia/Kolkata', now: NOW })
    expect(out.stats).toMatchObject({
      total: 10,
      byVerdict: { reel: 4, source_only: 6 },
      labelled: 2,
      agreed: 1,
      agreementRate: 0.5,
    })
    expect(out.stats.costUsd).toBeCloseTo(0.004)
    expect(out.counts.pending).toBe(8)
    expect(out.sources).toEqual([
      { source: 'hn', decided: 6, reels: 0, labelled: 4, judgeRight: 3 },
    ])
    expect(out.trend).toHaveLength(7)
    expect(out.trend.at(-1)).toEqual({ x: '2026-11-15', reel: 4, source_only: 6 })
    const trend = queries.find((q) => sqlHas(q, 'date_trunc'))!
    expect(trend.parameters).toContain('Asia/Kolkata')
    expect(trend.sql).not.toContain('Asia/Kolkata')
    const since = queries.find((q) => sqlHas(q, 'group by source'))!.parameters.at(-1) as Date
    expect(NOW.getTime() - new Date(since).getTime()).toBe(86_400_000)
  })
})

describe('judge agreement', () => {
  it('inverts explore rows in the per-source SQL, counting labels the way core does', async () => {
    const { db, queries } = scriptedDb(() => [])
    await gateSourceReview(db, { since: NOW })
    const text = queries[0]!.sql
    expect(text).toContain("(label = 'agree') <> (decided_by = 'explore')")
    expect(text).toContain('count(label)::int as labelled')
    expect(text).not.toContain("filter (where label = 'agree')")
  })
})

describe('loadGateQueue', () => {
  const opts = {
    page: PAGE,
    filters: NO_FILTERS,
    sort: DEFAULT_GATE_SORT,
    rangeDays: 7,
    tz: 'UTC',
  }

  it('returns the overview and the page of rows', async () => {
    const { db } = scriptedDb(respondOverview)
    const queue = await loadGateQueue(db, log, opts)
    expect(queue?.rows).toHaveLength(1)
    expect(queue?.overview.stats.total).toBe(10)
    expect(queue?.outcomes.size).toBe(0)
  })

  it('returns null instead of throwing when the gate table does not exist', async () => {
    const { db } = scriptedDb((q) =>
      sqlHas(q, 'gate_decision') ? new Error('relation "gate_decision" does not exist') : [],
    )
    expect(await loadGateQueue(db, log, opts)).toBeNull()
  })

  it('keeps the page when only the outcome query fails', async () => {
    const { db } = scriptedDb((q) =>
      sqlHas(q, 'from "item"') ? new Error('boom') : respondOverview(q),
    )
    const queue = await loadGateQueue(db, log, opts)
    expect(queue?.rows).toHaveLength(1)
    expect(queue?.outcomes.size).toBe(0)
  })
})

describe('recentJudgedDecisions', () => {
  it('reads only rows scored by the current prompt version, newest first', async () => {
    const { db, queries } = scriptedDb(() => [
      { score: 71, threshold: 55, verdict: 'reel', label: 'agree', source: 'hn' },
      { score: 10, threshold: 55, verdict: 'unknown', label: null, source: 'hn' },
      { score: null, threshold: 55, verdict: 'reel', label: null, source: 'hn' },
    ])
    const out = await recentJudgedDecisions(db, { limit: 200, labelledOnly: true })
    expect(out).toEqual([
      { score: 71, threshold: 55, verdict: 'reel', label: 'agree', source: 'hn' },
    ])
    const q = queries[0]!
    expect(q.sql).not.toContain('"signals"')
    expect(q.sql).toContain('"gate_decision"."prompt_version" = $')
    expect(q.sql).toContain('"gate_decision"."score" is not null')
    expect(q.sql).toContain('"gate_decision"."label" is not null')
    expect(q.sql).toContain('order by "gate_decision"."created_at" desc')
    expect(q.parameters).toEqual(
      expect.arrayContaining(['model', 'explore', 'auto', GATE_PROMPT_VERSION, 200]),
    )
  })
})
