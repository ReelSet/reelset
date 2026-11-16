import { describe, expect, it } from 'vitest'
import { ZodError } from 'zod'
import {
  DEFAULT_GATE_INSTRUCTIONS,
  DEFAULT_GATE_SOURCE_RULES,
  DEFAULT_GATE_WEIGHTS,
} from '../domain/gate'
import { createLogger } from '../lib/logger'
import { fakeDb } from './fake-db'
import {
  GATE_RATIONALE_MAX_CHARS,
  GATE_REASONS_MAX,
  GATE_REASON_MAX_CHARS,
  clearGateLabel,
  gateStats,
  labelGateDecision,
  latestGateDecision,
  latestGateJudgement,
  listGateExamples,
  loadGateConfig,
  recordGateDecision,
  summarizeGateStats,
  type GateDecisionInput,
  type GateStatsRow,
} from './gate.repo'
import { SETTINGS } from './settings.repo'

const log = createLogger({ app: 'test', level: 'silent' })

type Captured = { sql: string; params: readonly unknown[] }

function capture(rows: Record<string, unknown>[] = [{ id: 'd1' }]) {
  const statements: Captured[] = []
  const { db } = fakeDb((sql, params) => {
    statements.push({ sql, params })
    return rows
  })
  return { db, statements }
}

const modelDecision = (over: Partial<GateDecisionInput> = {}): GateDecisionInput => ({
  itemId: 'i1',
  verdict: 'reel',
  score: 72.5,
  threshold: 55,
  signals: { hook: 8, visual: 7 },
  reasons: ['clear demo'],
  rationale: 'Shows a working demo with a concrete speedup.',
  decidedBy: 'model',
  mode: 'shadow',
  applied: false,
  model: 'claude-haiku-5-5',
  configHash: 'abc123def456',
  costUsd: 0.0007,
  ...over,
})

describe('recordGateDecision', () => {
  it('inserts one row and returns it', async () => {
    const { db, statements } = capture([{ id: 'd1', item_id: 'i1' }])
    expect(await recordGateDecision(db, modelDecision(), log)).toEqual({ id: 'd1', item_id: 'i1' })
    expect(statements).toHaveLength(1)
    expect(statements[0]!.sql).toMatch(/^insert into "gate_decision"/)
    expect(statements[0]!.sql).toContain('returning *')
    expect(statements[0]!.params).toEqual([
      'i1',
      'reel',
      72.5,
      55,
      '{"hook":8,"visual":7}',
      ['clear demo'],
      'Shows a working demo with a concrete speedup.',
      'model',
      null,
      'shadow',
      false,
      'claude-haiku-5-5',
      'gate-v3',
      'abc123def456',
      0.0007,
      'auto',
    ])
  })

  it('stores a manual judgement as such and refuses to mark one applied', async () => {
    const { db, statements } = capture()
    await recordGateDecision(db, modelDecision({ trigger: 'manual' }), log)
    expect(statements[0]!.sql).toContain('"trigger"')
    expect(statements[0]!.params.at(-1)).toBe('manual')
    await expect(
      recordGateDecision(
        db,
        modelDecision({ trigger: 'manual', mode: 'live', applied: true }),
        log,
      ),
    ).rejects.toBeInstanceOf(ZodError)
    expect(statements).toHaveLength(1)
  })

  it('stores a rule decision with no score, signals, model or cost', async () => {
    const { db, statements } = capture()
    await recordGateDecision(
      db,
      {
        itemId: 'i1',
        verdict: 'source_only',
        threshold: 55,
        decidedBy: 'rule',
        rule: 'always_source_only',
        mode: 'live',
        applied: true,
        configHash: 'abc123def456',
      },
      log,
    )
    expect(statements[0]!.params).toEqual([
      'i1',
      'source_only',
      null,
      55,
      '{}',
      [],
      '',
      'rule',
      'always_source_only',
      'live',
      true,
      null,
      'gate-v3',
      'abc123def456',
      0,
      'auto',
    ])
  })

  it('cuts model text to size and drops unusable signals instead of losing the decision', async () => {
    const { db, statements } = capture()
    await recordGateDecision(
      db,
      modelDecision({
        signals: { hook: 14, visual: Number.NaN },
        reasons: [' padded ', '', 'x'.repeat(500), 'a', 'b', 'c', 'd', 'e'],
        rationale: 'y'.repeat(5000),
      }),
      log,
    )
    const params = statements[0]!.params
    expect(params[4]).toBe('{"hook":10}')
    const reasons = params[5] as string[]
    expect(reasons).toHaveLength(GATE_REASONS_MAX)
    expect(reasons[0]).toBe('padded')
    expect(reasons[1]).toHaveLength(GATE_REASON_MAX_CHARS)
    expect(params[6]).toHaveLength(GATE_RATIONALE_MAX_CHARS)
  })

  it('rejects what the table would reject, before any query', async () => {
    const { db, statements } = capture()
    const bad: Partial<GateDecisionInput>[] = [
      { verdict: 'maybe' as never },
      { decidedBy: 'cron' as never },
      { mode: 'off' as never },
      { score: 101 },
      { score: Number.NaN },
      { threshold: -1 },
      { costUsd: -0.1 },
      { decidedBy: 'rule', rule: null },
      { itemId: '' },
      { configHash: '' },
    ]
    for (const over of bad) {
      await expect(recordGateDecision(db, modelDecision(over), log)).rejects.toBeInstanceOf(
        ZodError,
      )
    }
    expect(statements).toHaveLength(0)
  })
})

describe('latestGateDecision', () => {
  it('reads the newest row for the item', async () => {
    const { db, statements } = capture([{ id: 'd2' }])
    expect(await latestGateDecision(db, 'i1')).toEqual({ id: 'd2' })
    expect(statements[0]!.sql).toMatch(
      /where "item_id" = \$1 and "trigger" = \$2 order by "created_at" desc, "id" desc limit \$3/,
    )
    expect(statements[0]!.params).toEqual(['i1', 'auto', 1])
  })

  it('latestGateJudgement reads the newest row of any trigger, manual ones included', async () => {
    const { db, statements } = capture([{ id: 'd3', trigger: 'manual' }])
    expect(await latestGateJudgement(db, 'i1')).toEqual({ id: 'd3', trigger: 'manual' })
    expect(statements[0]!.sql).toMatch(
      /where "item_id" = \$1 order by "created_at" desc, "id" desc limit \$2/,
    )
    expect(statements[0]!.sql).not.toContain('"trigger"')
  })

  it('is null for an item that was never judged', async () => {
    expect(await latestGateDecision(capture([]).db, 'i1')).toBeNull()
  })
})

describe('labelGateDecision', () => {
  it('stores a disagreement with its reason, note and reviewer', async () => {
    const { db, statements } = capture([{ id: 'd1', label: 'disagree' }])
    const row = await labelGateDecision(
      db,
      { id: 'd1', label: 'disagree', reason: 'rehash', note: '  seen it  ', adminId: 'a1' },
      log,
    )
    expect(row).toEqual({ id: 'd1', label: 'disagree' })
    expect(statements[0]!.sql).toMatch(
      /^update "gate_decision" set "label" = \$1, "label_reason" = \$2, "label_note" = \$3, "labeled_by" = \$4, "labeled_at" = now\(\) where "id" = \$5/,
    )
    expect(statements[0]!.params).toEqual(['disagree', 'rehash', 'seen it', 'a1', 'd1'])
  })

  it('stores no reason for an agreement and no note for a blank one', async () => {
    const { db, statements } = capture()
    await labelGateDecision(
      db,
      { id: 'd1', label: 'agree', reason: 'rehash', note: '   ', adminId: 'a1' },
      log,
    )
    expect(statements[0]!.params).toEqual(['agree', null, null, 'a1', 'd1'])
  })

  it('refuses a disagreement without a reason, an unknown reason and an over-long note', async () => {
    const { db, statements } = capture()
    const base = { id: 'd1', adminId: 'a1' }
    await expect(labelGateDecision(db, { ...base, label: 'disagree' }, log)).rejects.toBeInstanceOf(
      ZodError,
    )
    await expect(
      labelGateDecision(db, { ...base, label: 'disagree', reason: 'boring' as never }, log),
    ).rejects.toBeInstanceOf(ZodError)
    await expect(
      labelGateDecision(db, { ...base, label: 'agree', note: 'n'.repeat(501) }, log),
    ).rejects.toBeInstanceOf(ZodError)
    expect(statements).toHaveLength(0)
  })

  it('is null when the decision no longer exists', async () => {
    const input = { id: 'gone', label: 'agree', adminId: 'a1' } as const
    expect(await labelGateDecision(capture([]).db, input, log)).toBeNull()
  })
})

describe('clearGateLabel', () => {
  it('blanks every review field so the decision returns to the queue', async () => {
    const { db, statements } = capture([{ id: 'd1', label: null }])
    expect(await clearGateLabel(db, 'd1', log)).toEqual({ id: 'd1', label: null })
    expect(statements[0]!.sql).toMatch(
      /^update "gate_decision" set "label" = \$1, "label_reason" = \$2, "label_note" = \$3, "labeled_by" = \$4, "labeled_at" = \$5 where "id" = \$6/,
    )
    expect(statements[0]!.params).toEqual([null, null, null, null, null, 'd1'])
  })

  it('is null when the decision no longer exists', async () => {
    expect(await clearGateLabel(capture([]).db, 'gone', log)).toBeNull()
  })
})

describe('listGateExamples', () => {
  const row = (over: Record<string, unknown>) => ({
    id: 'd1',
    item_id: 'i1',
    title: 'A repo',
    canonical_url: 'https://example.com/a',
    source: 'github',
    verdict: 'reel',
    decided_by: 'model',
    label: 'agree',
    label_reason: null,
    label_note: null,
    score: 70,
    labeled_at: '2026-11-10T00:00:00Z',
    ...over,
  })

  it('asks for one labelled decision per item, ranked per side so the two sides alternate', async () => {
    const { db, statements } = capture([])
    await listGateExamples(db, { limit: 8 })
    const { sql, params } = statements[0]!
    expect(sql).toContain('select distinct on (d.item_id)')
    expect(sql).toContain('where d.label is not null')
    expect(sql).toContain("(d.label = 'agree') = (d.verdict = 'reel') as should_be_reel")
    expect(sql).toContain('partition by should_be_reel order by labeled_at desc')
    expect(sql).toContain('join item on item.id = ranked.item_id')
    expect(sql).toContain('order by ranked.side_rank, ranked.labeled_at desc')
    expect(params).toEqual([8])
  })

  it('returns newest first with the correct answer worked out from the label', async () => {
    const { db } = capture([
      row({ id: 'old', labeled_at: '2026-11-01T00:00:00Z' }),
      row({
        id: 'new',
        item_id: 'i2',
        verdict: 'reel',
        label: 'disagree',
        label_reason: 'rehash',
        label_note: 'third post this week',
        source: 'hn',
        labeled_at: '2026-11-12T00:00:00Z',
      }),
      row({
        id: 'mid',
        item_id: 'i3',
        verdict: 'source_only',
        label: 'disagree',
        label_reason: 'actually_interesting',
        score: null,
        labeled_at: new Date('2026-11-05T00:00:00Z'),
      }),
    ])
    const examples = await listGateExamples(db, { limit: 8 })
    expect(examples.map((e) => e.decisionId)).toEqual(['new', 'mid', 'old'])
    expect(examples[0]).toEqual({
      decisionId: 'new',
      itemId: 'i2',
      title: 'A repo',
      url: 'https://example.com/a',
      source: 'hn',
      verdict: 'reel',
      decidedBy: 'model',
      label: 'disagree',
      correctVerdict: 'source_only',
      labelReason: 'rehash',
      labelNote: 'third post this week',
      score: 70,
      labeledAt: new Date('2026-11-12T00:00:00Z'),
    })
    expect(examples[1]).toMatchObject({ correctVerdict: 'reel', score: null })
    expect(examples[2]).toMatchObject({ correctVerdict: 'reel', labelReason: null })
  })

  it('drops rows with an unknown verdict or label and tolerates unknown reasons and sources', async () => {
    const { db } = capture([
      row({ id: 'bad-verdict', verdict: 'maybe' }),
      row({ id: 'bad-label', label: 'meh' }),
      row({ id: 'ok', label: 'disagree', label_reason: 'retired_reason', source: 'mastodon' }),
    ])
    const examples = await listGateExamples(db, { limit: 8 })
    expect(examples).toHaveLength(1)
    expect(examples[0]).toMatchObject({ decisionId: 'ok', labelReason: null, source: 'unknown' })
  })

  it('skips the query for a zero, negative or non-numeric limit and caps a large one', async () => {
    const { db, statements } = capture([])
    for (const limit of [0, -3, Number.NaN])
      expect(await listGateExamples(db, { limit })).toEqual([])
    expect(statements).toHaveLength(0)
    await listGateExamples(db, { limit: 10_000 })
    expect(statements[0]!.params).toEqual([50])
  })
})

describe('summarizeGateStats', () => {
  const group = (over: Partial<GateStatsRow>): GateStatsRow => ({
    verdict: 'reel',
    decided_by: 'model',
    source: 'github',
    decisions: 0,
    labelled: 0,
    agreed: 0,
    cost_usd: 0,
    ...over,
  })

  it('is all zeroes with no agreement rate when nothing was decided', () => {
    expect(summarizeGateStats([])).toEqual({
      total: 0,
      byVerdict: { reel: 0, source_only: 0 },
      byDecidedBy: { rule: 0, model: 0, explore: 0, admin: 0 },
      bySource: {},
      labelled: 0,
      agreed: 0,
      agreementRate: null,
      costUsd: 0,
    })
  })

  it('measures the judge: an agree on an explore row counts against it, a disagree for it', () => {
    const stats = summarizeGateStats([
      group({ decisions: 4, labelled: 4, agreed: 3 }),
      group({ decided_by: 'explore', decisions: 5, labelled: 4, agreed: 3 }),
    ])
    expect(stats.labelled).toBe(8)
    expect(stats.agreed).toBe(4)
    expect(stats.agreementRate).toBe(0.5)
  })

  it('adds the groups up by verdict, decider and source', () => {
    const stats = summarizeGateStats([
      group({ decisions: 10, labelled: 4, agreed: 3, cost_usd: 0.01 }),
      group({
        verdict: 'source_only',
        decisions: '6',
        labelled: '4',
        agreed: '1',
        cost_usd: '0.006',
      }),
      group({ verdict: 'source_only', decided_by: 'rule', source: 'news', decisions: 5 }),
      group({ decided_by: 'explore', source: 'news', decisions: 1, cost_usd: 0.001 }),
      group({ decided_by: 'admin', source: 'somewhere', decisions: 2, labelled: 0 }),
    ])
    expect(stats.total).toBe(24)
    expect(stats.byVerdict).toEqual({ reel: 13, source_only: 11 })
    expect(stats.byDecidedBy).toEqual({ rule: 5, model: 16, explore: 1, admin: 2 })
    expect(stats.bySource).toEqual({
      github: { reel: 10, source_only: 6 },
      news: { reel: 1, source_only: 5 },
      unknown: { reel: 2, source_only: 0 },
    })
    expect(stats.labelled).toBe(8)
    expect(stats.agreed).toBe(4)
    expect(stats.agreementRate).toBe(0.5)
    expect(stats.costUsd).toBeCloseTo(0.017, 6)
  })

  it('ignores groups with a verdict or decider it does not know', () => {
    const stats = summarizeGateStats([
      group({ verdict: 'maybe', decisions: 9 }),
      group({ decided_by: 'cron', decisions: 9 }),
      group({ decisions: 1 }),
    ])
    expect(stats.total).toBe(1)
  })
})

describe('gateStats', () => {
  it('groups decisions since the given time and folds the rows', async () => {
    const since = new Date('2026-11-01T00:00:00Z')
    const { db, statements } = capture([
      {
        verdict: 'reel',
        decided_by: 'model',
        source: 'hn',
        decisions: 3,
        labelled: 2,
        agreed: 2,
        cost_usd: 0.002,
      },
    ])
    const stats = await gateStats(db, { since })
    expect(stats).toMatchObject({ total: 3, labelled: 2, agreementRate: 1, costUsd: 0.002 })
    const { sql, params } = statements[0]!
    expect(sql).toContain('where d.created_at >= $1 and d.trigger = $2')
    expect(sql).toContain('group by verdict, decided_by, source')
    expect(sql).toContain("count(*) filter (where label = 'agree')")
    expect(params).toEqual([since, 'auto'])
  })

  it('counts manual judgements only when asked for them', async () => {
    const since = new Date('2026-11-01T00:00:00Z')
    const { db, statements } = capture([])
    await gateStats(db, { since, trigger: 'manual' })
    expect(statements[0]!.params).toEqual([since, 'manual'])
  })

  it('still reads labelled manual judgements as examples', async () => {
    const { db, statements } = capture([])
    await listGateExamples(db, { limit: 4 })
    expect(statements[0]!.sql).not.toContain('trigger')
  })
})

describe('loadGateConfig', () => {
  it('reads all eleven gate settings in one query and falls back to defaults', async () => {
    const { db, statements } = capture([])
    const config = await loadGateConfig(db, log)
    expect(statements).toHaveLength(1)
    expect(statements[0]!.sql).toMatch(/from "app_setting" where "key" in \(/)
    expect([...statements[0]!.params].sort()).toEqual(
      Object.values(SETTINGS)
        .map((setting) => setting.key)
        .filter((key) => key.startsWith('gate_'))
        .sort(),
    )
    expect(statements[0]!.params).toHaveLength(11)
    expect(config).toEqual({
      mode: 'shadow',
      threshold: 55,
      weights: DEFAULT_GATE_WEIGHTS,
      sourceRules: DEFAULT_GATE_SOURCE_RULES,
      instructions: DEFAULT_GATE_INSTRUCTIONS,
      model: 'claude-haiku-5-5',
      effort: 'low',
      exploreRate: 0.05,
      exampleCount: 8,
      performanceExamples: 8,
      maxCostUsdPerItem: 0.01,
    })
  })

  it('uses stored values, fills partial objects and replaces invalid values with defaults', async () => {
    const { db } = capture([
      { key: 'gate_mode', value: 'live' },
      { key: 'gate_threshold', value: 140 },
      { key: 'gate_weights', value: { hook: 5 } },
      { key: 'gate_source_rules', value: { papers: { mode: 'always_source_only' } } },
      { key: 'gate_model', value: 'claude-sonnet-5-5' },
      { key: 'gate_explore_rate', value: 0.9 },
    ])
    const config = await loadGateConfig(db, log)
    expect(config.mode).toBe('live')
    expect(config.threshold).toBe(55)
    expect(config.weights).toEqual({ ...DEFAULT_GATE_WEIGHTS, hook: 5 })
    expect(config.sourceRules.papers).toEqual({ mode: 'always_source_only' })
    expect(config.sourceRules.hn).toEqual({ mode: 'judge' })
    expect(config.model).toBe('claude-sonnet-5-5')
    expect(config.exploreRate).toBe(0.05)
  })
})
