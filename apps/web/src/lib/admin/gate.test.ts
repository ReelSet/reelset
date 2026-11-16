import {
  GATE_DECIDERS,
  GATE_LABELS,
  GATE_LABEL_REASONS,
  GATE_VERDICTS,
  judgeWasRight,
  type GateDecisionRow,
} from '@reelset/core'
import { describe, expect, it } from 'vitest'
import {
  GATE_BULK_LIMIT,
  JUDGE_WAS_RIGHT_SQL,
  disagreeReasonsFor,
  gateBulkAgreeSchema,
  gateFilterParams,
  gateLabelFormSchema,
  gateTrendPoints,
  isDisagreeReasonFor,
  parseGateFilters,
  parseGateRange,
  share,
  toGateView,
} from './gate'

const ID = '11111111-2222-4333-8444-555555555555'

const row = (patch: Partial<GateDecisionRow> = {}): GateDecisionRow => ({
  id: ID,
  item_id: 'item-1',
  verdict: 'source_only',
  score: 41.5,
  threshold: 55,
  signals: { hook: 4, visual: 12, bogus: 9 },
  reasons: ['routine release'],
  rationale: 'A changelog.',
  decided_by: 'model',
  rule: null,
  mode: 'shadow',
  applied: false,
  trigger: 'auto',
  model: 'claude-haiku-5-5',
  prompt_version: 'gate-v1',
  config_hash: 'abc',
  cost_usd: 0.001,
  label: null,
  label_reason: null,
  label_note: null,
  labeled_by: null,
  labeled_at: null,
  created_at: new Date('2026-11-15T10:00:00Z'),
  ...patch,
})

describe('parseGateFilters', () => {
  it('defaults to the review queue with no other filter', () => {
    expect(parseGateFilters({})).toEqual({
      review: 'pending',
      verdict: null,
      decidedBy: null,
      source: null,
      trigger: null,
      q: null,
    })
  })

  it('keeps only whitelisted values and trims the search', () => {
    const filters = parseGateFilters({
      review: 'disagreed',
      verdict: 'reel',
      by: ['explore', 'rule'],
      source: 'github',
      q: `  ${'x'.repeat(200)}  `,
    })
    expect(filters).toMatchObject({
      review: 'disagreed',
      verdict: 'reel',
      decidedBy: 'explore',
      source: 'github',
    })
    expect(filters.q).toHaveLength(80)
    expect(parseGateFilters({ review: 'nope', verdict: 'drop', by: 'root', source: 'x' })).toEqual(
      parseGateFilters({}),
    )
  })

  it('round-trips through URL params and omits the defaults', () => {
    const sp = {
      review: 'all',
      verdict: 'source_only',
      by: 'model',
      source: 'hn',
      trigger: 'manual',
      q: 'rust',
    }
    expect(gateFilterParams(parseGateFilters(sp))).toEqual(sp)
    expect(Object.values(gateFilterParams(parseGateFilters({}))).filter(Boolean)).toEqual([])
  })
})

describe('parseGateRange', () => {
  it('accepts 1d, 7d and 30d and falls back to 7d', () => {
    expect(parseGateRange('1d')).toBe(1)
    expect(parseGateRange('30d')).toBe(30)
    expect(parseGateRange('90d')).toBe(7)
    expect(parseGateRange(undefined)).toBe(7)
  })
})

describe('disagreeReasonsFor', () => {
  it('offers reasons that argue for the opposite verdict, plus the neutral one', () => {
    const forSourceOnly = disagreeReasonsFor('source_only').map((reason) => reason.key)
    expect(forSourceOnly).toEqual([
      'actually_interesting',
      'strong_visuals_missed',
      'funny_or_timely',
      'big_name_or_drama',
      'other',
    ])
    const forReel = disagreeReasonsFor('reel').map((reason) => reason.key)
    expect(forReel).toContain('too_niche')
    expect(forReel).toContain('nobody_would_care')
    expect(forReel).toContain('other')
    expect(forReel).not.toContain('actually_interesting')
    expect(forReel).not.toContain('funny_or_timely')
  })

  it('covers every core reason on exactly one side, or both when neutral', () => {
    for (const reason of GATE_LABEL_REASONS) {
      const sides = [
        isDisagreeReasonFor('reel', reason.key),
        isDisagreeReasonFor('source_only', reason.key),
      ]
      expect(sides.filter(Boolean)).toHaveLength(reason.shouldBe === null ? 2 : 1)
    }
  })
})

describe('gate form schemas', () => {
  it('requires a reason only for a disagreement and treats blanks as absent', () => {
    expect(
      gateLabelFormSchema.safeParse({ id: ID, label: 'agree', reason: '', note: '' }).data,
    ).toEqual({ id: ID, label: 'agree', reason: null, note: null })
    expect(gateLabelFormSchema.safeParse({ id: ID, label: 'disagree', reason: '' }).success).toBe(
      false,
    )
    expect(
      gateLabelFormSchema.safeParse({ id: ID, label: 'disagree', reason: 'too_niche' }).success,
    ).toBe(true)
    expect(gateLabelFormSchema.safeParse({ id: 'x', label: 'agree' }).success).toBe(false)
  })

  it('caps a bulk agree', () => {
    const ids = (n: number) => Array.from({ length: n }, () => ID)
    expect(gateBulkAgreeSchema.safeParse({ ids: [] }).success).toBe(false)
    expect(gateBulkAgreeSchema.safeParse({ ids: ids(GATE_BULK_LIMIT) }).success).toBe(true)
    expect(gateBulkAgreeSchema.safeParse({ ids: ids(GATE_BULK_LIMIT + 1) }).success).toBe(false)
  })
})

describe('toGateView', () => {
  it('projects a decision with clamped, labelled signals in a fixed order', () => {
    const view = toGateView(row())!
    expect(view).toMatchObject({
      decisionId: ID,
      itemId: 'item-1',
      verdict: 'source_only',
      score: 41.5,
      threshold: 55,
      decidedBy: 'model',
      applied: false,
      label: null,
      decidedAt: '2026-11-15T10:00:00.000Z',
    })
    expect(view.signals.map((signal) => signal.key)).toEqual([
      'hook',
      'visual',
      'novelty',
      'audience',
      'clarity',
      'stakes',
    ])
    expect(view.signals[0]).toEqual({ key: 'hook', label: 'Hook', value: 4, pct: 40 })
    expect(view.signals[1]).toMatchObject({ value: 10, pct: 100 })
    expect(view.signals[2]).toMatchObject({ value: null, pct: 0 })
    expect(view.disagreeReasons.map((reason) => reason.key)).toContain('actually_interesting')
  })

  it('lists no signals for a gate-v2 row, which stores only the overall score', () => {
    const view = toGateView(row({ signals: {}, prompt_version: 'gate-v2', score: 72 }))!
    expect(view.signals).toEqual([])
    expect(view).toMatchObject({ score: 72, threshold: 55, promptVersion: 'gate-v2' })
    expect(view.reasons).toEqual(['routine release'])
    expect(view.rationale).toBe('A changelog.')
  })

  it('shows the label with a readable reason and keeps a null score for rule decisions', () => {
    const view = toGateView(
      row({
        verdict: 'reel',
        score: null,
        decided_by: 'rule',
        rule: 'always_reel',
        label: 'disagree',
        label_reason: 'too_niche',
        label_note: 'only for kernel devs',
      }),
    )!
    expect(view).toMatchObject({
      score: null,
      rule: 'always_reel',
      label: 'disagree',
      labelReason: 'Too niche',
      labelNote: 'only for kernel devs',
    })
  })

  it('never exposes the config hash, cost or who labelled it', () => {
    const json = JSON.stringify(toGateView(row({ labeled_by: 'admin-uuid' })))
    expect(json).not.toContain('abc')
    expect(json).not.toContain('admin-uuid')
    expect(json).not.toContain('cost')
  })

  it('drops a row with an unknown verdict', () => {
    expect(toGateView(row({ verdict: 'maybe' }))).toBeNull()
  })
})

describe('gateTrendPoints', () => {
  it('zero-fills every day and ignores unknown verdicts and days', () => {
    const points = gateTrendPoints(
      [
        { day: '2026-11-14', verdict: 'reel', decisions: 3 },
        { day: '2026-11-14', verdict: 'source_only', decisions: 2 },
        { day: '2026-11-14', verdict: 'maybe', decisions: 9 },
        { day: '2026-01-01', verdict: 'reel', decisions: 9 },
      ],
      ['2026-11-13', '2026-11-14'],
    )
    expect(points).toEqual([
      { x: '2026-11-13', reel: 0, source_only: 0 },
      { x: '2026-11-14', reel: 3, source_only: 2 },
    ])
  })
})

describe('share', () => {
  it('is null when there is nothing to divide by', () => {
    expect(share(1, 4)).toBe(0.25)
    expect(share(0, 0)).toBeNull()
  })
})

describe('explore rows', () => {
  const explore = (patch: Partial<GateDecisionRow> = {}) =>
    toGateView(
      row({ verdict: 'reel', decided_by: 'explore', score: 41.5, applied: true, ...patch }),
    )!

  it('shows what the judge said, not the stored outcome', () => {
    expect(explore()).toMatchObject({
      verdict: 'reel',
      judgeVerdict: 'source_only',
      explored: true,
      score: 41.5,
      threshold: 55,
      reviewQuestion: 'Was making this a reel the right call?',
    })
    expect(toGateView(row())).toMatchObject({
      judgeVerdict: 'source_only',
      explored: false,
      reviewQuestion: 'Was keeping this as source only the right call?',
    })
  })

  it('offers the reasons for "this should not have been a reel" when disagreeing', () => {
    const keys = explore().disagreeReasons.map((reason) => reason.key)
    expect(keys).toContain('too_niche')
    expect(keys).toContain('other')
    expect(keys).not.toContain('actually_interesting')
    expect(explore().disagreePrompt).toBe('Why should this not be a reel?')
  })
})

// Runs the SQL condition as JavaScript: the text only uses =, <> and string literals over two columns.
function sqlJudgeWasRight(label: string, decidedBy: string): boolean {
  const js = JUDGE_WAS_RIGHT_SQL.replaceAll('<>', '!==').replace(/(?<![!=])=(?!=)/g, '===')
  return new Function('label', 'decided_by', `return ${js}`)(label, decidedBy) as boolean
}

describe('JUDGE_WAS_RIGHT_SQL', () => {
  it('gives the same answer as core for every verdict, decider and label', () => {
    for (const verdict of GATE_VERDICTS) {
      for (const decidedBy of GATE_DECIDERS) {
        for (const label of GATE_LABELS) {
          expect(sqlJudgeWasRight(label, decidedBy), `${verdict} ${decidedBy} ${label}`).toBe(
            judgeWasRight({ verdict, decidedBy, label }),
          )
        }
      }
    }
  })

  it('counts an agreed explore row against the judge and a disagreed one for it', () => {
    expect(sqlJudgeWasRight('agree', 'explore')).toBe(false)
    expect(sqlJudgeWasRight('disagree', 'explore')).toBe(true)
    expect(sqlJudgeWasRight('agree', 'admin')).toBe(true)
  })
})

describe('applied note', () => {
  const note = (patch: Partial<GateDecisionRow>) => toGateView(row(patch))!.appliedNote

  it('says nothing for an applied decision', () => {
    expect(note({ mode: 'live', applied: true })).toBeNull()
  })

  it('explains a live source-only decision that was not applied', () => {
    expect(note({ mode: 'live', applied: false, verdict: 'source_only' })).toBe(
      'Not applied: requested by a user',
    )
  })

  it('marks a manual judgement as analysis only', () => {
    const view = toGateView(row({ trigger: 'manual', mode: 'shadow', applied: false }))!
    expect(view.manual).toBe(true)
    expect(view.appliedNote).toBe('Not applied: manual check, analysis only')
    expect(toGateView(row())!.manual).toBe(false)
  })

  it('names shadow mode as the reason otherwise', () => {
    expect(note({ mode: 'shadow', applied: false })).toBe('Not applied: shadow mode')
    expect(note({ mode: 'live', applied: false, verdict: 'reel' })).toBe('Not applied')
  })
})
