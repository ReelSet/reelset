import { createLogger } from '@reelset/core'
import type { CompiledQuery } from 'kysely'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GATE_FIELD } from '@/lib/admin/gate-fields'
import { scriptedDb, sqlHas, type Scripted } from './scripted-db'

vi.mock('@reelset/core', async (orig) => {
  const actual = await orig<typeof import('@reelset/core')>()
  return {
    ...actual,
    transitionItem: vi.fn(actual.transitionItem),
    recordGateDecision: vi.fn(actual.recordGateDecision),
    labelGateDecision: vi.fn(actual.labelGateDecision),
    clearGateLabel: vi.fn(actual.clearGateLabel),
  }
})

const core = await import('@reelset/core')
const {
  bulkAgree,
  clearDecisionLabel,
  disagreeAndMakeReel,
  labelDecision,
  makeReelAnyway,
  resetGateSetting,
  saveGateSettings,
  testGateTuning,
  thresholdSuggestion,
} = await import('./gate')

const log = createLogger({ app: 'test', level: 'silent' })
const DECISION = '11111111-2222-4333-8444-555555555555'
const ITEM = '99999999-2222-4333-8444-555555555555'
const ADMIN = 'aaaaaaaa-2222-4333-8444-555555555555'

type World = {
  verdict: string | null
  labelFound: boolean
  itemIsSourceOnly: boolean
  judged: Record<string, unknown>[]
  gateTable: boolean
}

const world = (patch: Partial<World> = {}): World => ({
  verdict: 'source_only',
  labelFound: true,
  itemIsSourceOnly: true,
  judged: [],
  gateTable: true,
  ...patch,
})

const decisionRow = (w: World, label: string | null) => ({
  id: DECISION,
  item_id: ITEM,
  verdict: w.verdict,
  label,
})

function respond(w: World) {
  return (q: CompiledQuery): Scripted => {
    if (sqlHas(q, '"gate_decision"') && !w.gateTable) {
      return new Error('relation "gate_decision" does not exist')
    }
    if (sqlHas(q, 'select "verdict" from "gate_decision"')) {
      return w.verdict ? [{ verdict: w.verdict }] : []
    }
    if (sqlHas(q, 'update "gate_decision"') && sqlHas(q, 'returning')) {
      const label = q.parameters.includes('disagree') ? 'disagree' : 'agree'
      return w.labelFound ? [decisionRow(w, sqlHas(q, '"label" = $1') ? label : null)] : []
    }
    if (sqlHas(q, 'update "gate_decision"')) return { affected: 2 }
    if (sqlHas(q, 'update "item"') && sqlHas(q, '"status" =')) {
      return { affected: w.itemIsSourceOnly ? 1 : 0 }
    }
    if (sqlHas(q, 'insert into "gate_decision"')) return [{ id: 'new-decision' }]
    if (sqlHas(q, 'from "gate_decision"')) return w.judged
    return []
  }
}

const run = (patch: Partial<World> = {}) => scriptedDb(respond(world(patch)))

beforeEach(() => vi.clearAllMocks())

describe('labelDecision', () => {
  it('saves an agreement through the core repo without a reason', async () => {
    const { db } = run()
    const result = await labelDecision(db, { id: DECISION, label: 'agree', adminId: ADMIN }, log)
    expect(result).toEqual({ ok: true, message: 'Marked as agreed' })
    expect(core.labelGateDecision).toHaveBeenCalledWith(
      db,
      { id: DECISION, label: 'agree', reason: undefined, note: undefined, adminId: ADMIN },
      expect.anything(),
    )
  })

  it('requires a reason to disagree', async () => {
    const { db, queries } = run()
    const result = await labelDecision(
      db,
      { id: DECISION, label: 'disagree', reason: '', adminId: ADMIN },
      log,
    )
    expect(result).toEqual({ ok: false, message: 'Pick a reason for the disagreement' })
    expect(queries).toHaveLength(0)
  })

  it('saves a disagreement whose reason fits the verdict, with the note', async () => {
    const { db } = run({ verdict: 'source_only' })
    const result = await labelDecision(
      db,
      {
        id: DECISION,
        label: 'disagree',
        reason: 'actually_interesting',
        note: ' real demo ',
        adminId: ADMIN,
      },
      log,
    )
    expect(result).toEqual({ ok: true, message: 'Marked as disagreed' })
    expect(core.labelGateDecision).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ reason: 'actually_interesting', note: 'real demo' }),
      expect.anything(),
    )
  })

  it('refuses a reason that argues for the verdict the gate already gave', async () => {
    const { db } = run({ verdict: 'source_only' })
    const result = await labelDecision(
      db,
      { id: DECISION, label: 'disagree', reason: 'too_niche', adminId: ADMIN },
      log,
    )
    expect(result.ok).toBe(false)
    expect(core.labelGateDecision).not.toHaveBeenCalled()
  })

  it('reports a decision that no longer exists and rejects a bad id', async () => {
    const gone = run({ verdict: null })
    expect(
      await labelDecision(
        gone.db,
        { id: DECISION, label: 'disagree', reason: 'other', adminId: ADMIN },
        log,
      ),
    ).toEqual({ ok: false, message: 'Decision not found' })
    const missing = run({ labelFound: false })
    expect(
      await labelDecision(missing.db, { id: DECISION, label: 'agree', adminId: ADMIN }, log),
    ).toEqual({ ok: false, message: 'Decision not found' })
    expect(
      (await labelDecision(run().db, { id: 'x', label: 'agree', adminId: ADMIN }, log)).ok,
    ).toBe(false)
  })
})

describe('clearDecisionLabel', () => {
  it('clears through the core repo', async () => {
    const { db } = run()
    expect((await clearDecisionLabel(db, { id: DECISION }, log)).ok).toBe(true)
    expect(core.clearGateLabel).toHaveBeenCalledWith(db, DECISION, expect.anything())
  })

  it('rejects a bad id and reports a missing decision', async () => {
    expect(await clearDecisionLabel(run().db, { id: 'nope' }, log)).toEqual({
      ok: false,
      message: 'Invalid decision id',
    })
    expect(await clearDecisionLabel(run({ labelFound: false }).db, { id: DECISION }, log)).toEqual({
      ok: false,
      message: 'Decision not found',
    })
    expect(core.clearGateLabel).toHaveBeenCalledTimes(1)
  })
})

describe('bulkAgree', () => {
  const ids = [DECISION, ITEM, ADMIN]

  it('agrees only with unreviewed decisions, in one statement', async () => {
    const { db, queries } = run()
    const result = await bulkAgree(db, { ids, adminId: ADMIN }, log)
    expect(result).toEqual({ ok: true, message: 'Agreed with 2 decisions, 1 already reviewed' })
    expect(queries).toHaveLength(1)
    expect(queries[0]!.sql).toContain('"label" is null')
    expect(queries[0]!.sql).toContain('"decided_by" <> ')
    expect(queries[0]!.sql).toContain('"id" in ($')
    expect(queries[0]!.parameters.filter((p) => typeof p === 'string' && p.length === 36)).toEqual(
      expect.arrayContaining(ids),
    )
    expect(queries[0]!.parameters).toEqual(expect.arrayContaining(['agree', ADMIN, ...ids]))
  })

  it('refuses an empty, oversized or malformed selection without touching the db', async () => {
    const { db, queries } = run()
    const tooMany = Array.from({ length: 201 }, () => DECISION)
    for (const bad of [[], tooMany, ['not-a-guid'], 'x']) {
      expect((await bulkAgree(db, { ids: bad, adminId: ADMIN }, log)).ok).toBe(false)
    }
    expect(queries).toHaveLength(0)
  })
})

describe('makeReelAnyway', () => {
  it('moves source_only to found through transitionItem and records the admin decision', async () => {
    const { db, queries } = run()
    const result = await makeReelAnyway(db, { itemId: ITEM, adminId: ADMIN }, log)
    expect(result.ok).toBe(true)
    expect(core.transitionItem).toHaveBeenCalledWith(
      expect.anything(),
      {
        itemId: ITEM,
        from: 'source_only',
        to: 'found',
        meta: { gateOverride: true, adminId: ADMIN },
      },
      expect.anything(),
    )
    expect(core.recordGateDecision).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        itemId: ITEM,
        verdict: 'reel',
        decidedBy: 'admin',
        applied: true,
        mode: 'shadow',
        threshold: core.SETTINGS.gateThreshold.default,
        configHash: expect.stringMatching(/^[0-9a-f]{12}$/),
      }),
      expect.anything(),
    )
    const requeue = queries.find((q) => sqlHas(q, 'update "item"') && sqlHas(q, '"queued_at"'))
    expect(requeue?.sql).toContain('"attempts"')
    const insert = queries.find((q) => sqlHas(q, 'insert into "gate_decision"'))!
    expect(insert.parameters).toEqual(expect.arrayContaining([ITEM, 'reel', 'admin', true]))
  })

  it('refuses when the item is not source_only and records nothing', async () => {
    const { db, queries } = run({ itemIsSourceOnly: false })
    const result = await makeReelAnyway(db, { itemId: ITEM, adminId: ADMIN }, log)
    expect(result).toEqual({
      ok: false,
      message: 'Item is not source only, so there is nothing to override',
    })
    expect(core.recordGateDecision).not.toHaveBeenCalled()
    expect(queries.some((q) => sqlHas(q, 'insert into'))).toBe(false)
  })

  it('rejects a bad item id before any query', async () => {
    const { db, queries } = run()
    expect((await makeReelAnyway(db, { itemId: 'x', adminId: ADMIN }, log)).ok).toBe(false)
    expect(queries).toHaveLength(0)
  })
})

describe('disagreeAndMakeReel', () => {
  const input = { id: DECISION, reason: 'actually_interesting', adminId: ADMIN }

  it('labels the decision, then overrides the item the decision belongs to', async () => {
    const { db } = run()
    const result = await disagreeAndMakeReel(db, input, log)
    expect(result.ok).toBe(true)
    expect(core.labelGateDecision).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ label: 'disagree', reason: 'actually_interesting' }),
      expect.anything(),
    )
    expect(core.transitionItem).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ itemId: ITEM, from: 'source_only', to: 'found' }),
      expect.anything(),
    )
  })

  it('keeps the disagreement and says so when the override is refused', async () => {
    const { db } = run({ itemIsSourceOnly: false })
    const result = await disagreeAndMakeReel(db, input, log)
    expect(result.ok).toBe(false)
    expect(result.message).toContain('Disagreement saved')
    expect(core.labelGateDecision).toHaveBeenCalledTimes(1)
    expect(core.recordGateDecision).not.toHaveBeenCalled()
  })

  it('never overrides a decision that was already a reel', async () => {
    const { db } = run({ verdict: 'reel' })
    const result = await disagreeAndMakeReel(db, { ...input, reason: 'too_niche' }, log)
    expect(result.ok).toBe(false)
    expect(core.transitionItem).not.toHaveBeenCalled()
  })

  it('does nothing without a reason', async () => {
    const { db, queries } = run()
    expect((await disagreeAndMakeReel(db, { id: DECISION, adminId: ADMIN }, log)).ok).toBe(false)
    expect(queries).toHaveLength(0)
  })
})

describe('gate settings commands', () => {
  it('writes each submitted setting under its own key', async () => {
    const { db, queries } = run()
    const fields = { [GATE_FIELD.mode]: 'live', [GATE_FIELD.exploreRatePercent]: '10' }
    const result = await saveGateSettings(db, fields, log)
    expect(result).toEqual({ ok: true, message: 'Saved gate_mode, gate_explore_rate' })
    const writes = queries.filter((q) => sqlHas(q, 'insert into "app_setting"'))
    expect(writes.map((q) => q.parameters[0])).toEqual(['gate_mode', 'gate_explore_rate'])
    expect(writes.map((q) => q.parameters[1])).toEqual(['"live"', '0.1'])
  })

  it('writes nothing when one field is invalid', async () => {
    const { db, queries } = run()
    const fields = { [GATE_FIELD.mode]: 'live', [GATE_FIELD.threshold]: '500' }
    const result = await saveGateSettings(db, fields, log)
    expect(result.ok).toBe(false)
    expect(result.message).toContain('gate_threshold')
    expect(queries).toHaveLength(0)
  })

  it('resets a known setting to its default and refuses an unknown one', async () => {
    const { db, queries } = run()
    expect(await resetGateSetting(db, { name: 'instructions' }, log)).toEqual({
      ok: true,
      message: 'gate_instructions reset to default',
    })
    expect(queries[0]!.parameters[1]).toBe(JSON.stringify(core.DEFAULT_GATE_INSTRUCTIONS))
    expect((await resetGateSetting(db, { name: 'daily_reel_cap' }, log)).ok).toBe(false)
    expect(queries).toHaveLength(1)
  })
})

describe('testGateTuning', () => {
  const judged = (mark: number, label: string | null) => ({
    signals: {
      hook: mark,
      visual: mark,
      novelty: mark,
      audience: mark,
      clarity: mark,
      stakes: mark,
    },
    score: mark * 10,
    threshold: 55,
    verdict: mark * 10 >= 55 ? 'reel' : 'source_only',
    label,
    source: 'github',
  })
  const fields = {
    [GATE_FIELD.threshold]: '70',
    ...Object.fromEntries(
      Object.keys(core.DEFAULT_GATE_WEIGHTS).map((key) => [GATE_FIELD.weight(key), '1']),
    ),
  }

  it('re-scores stored decisions under the typed values and writes nothing', async () => {
    const { db, queries } = run({
      judged: [judged(8, 'agree'), judged(6, 'disagree'), judged(3, null)],
    })
    const out = await testGateTuning(db, fields, log)
    if (!out.ok) throw new Error(out.message)
    expect(out.result).toMatchObject({
      sample: 3,
      reelToSourceOnly: 1,
      sourceOnlyToReel: 0,
      labelled: 2,
      matchedBefore: 1,
      matchedAfter: 2,
    })
    expect(out.suggestion).toBeNull()
    expect(queries.every((q) => q.sql.startsWith('select'))).toBe(true)
    const sample = queries.find((q) => sqlHas(q, 'from "gate_decision"'))!
    expect(sample.sql).toContain('"gate_decision"."score" is not null')
    expect(sample.parameters).toEqual(expect.arrayContaining(['model', 'explore', 200]))
  })

  it('rejects invalid typed values before reading anything', async () => {
    const { db, queries } = run()
    const out = await testGateTuning(db, { ...fields, [GATE_FIELD.threshold]: 'high' }, log)
    expect(out.ok).toBe(false)
    expect(queries).toHaveLength(0)
  })

  it('fails soft when the gate table is missing', async () => {
    const { db } = run({ gateTable: false })
    expect(await testGateTuning(db, fields, log)).toMatchObject({ ok: false })
    const tuning = { threshold: 55, weights: core.DEFAULT_GATE_WEIGHTS }
    expect(await thresholdSuggestion(db, tuning, log)).toBeNull()
  })
})
