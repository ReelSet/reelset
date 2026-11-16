import Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it } from 'vitest'
import {
  gateCallCostUsd,
  GATE_PROMPT_VERSION,
  shouldExplore,
  type GateDecisionRow,
} from '@reelset/core'
import {
  isAdminReelOverride,
  retryBlocker,
  reusableDecision,
  runGate,
  settleJudgement,
} from '../src/pipeline/gate'
import { asClaudeQuotaError } from '../src/pipeline/claude'
import { QuotaExhaustedError } from '../src/pipeline/quota'
import { createFakeDb } from './helpers/fake-db'
import {
  gateExampleRow,
  gateItem,
  gateQueries,
  judgeAnswer,
  makeGateWorld,
  makeJudge,
  performanceRows,
  NEVER_ANSWERS,
  type GateWorld,
  type JudgeUsage,
} from './helpers/gate'
import { testLog } from './helpers/mock-fetch'

const EXPLORE_RATE = 0.5
const ids = Array.from({ length: 200 }, (_, i) => `item-${i}`)
const EXPLORED_ID = ids.find((id) => shouldExplore(id, EXPLORE_RATE))!
const UNEXPLORED_ID = ids.find((id) => !shouldExplore(id, EXPLORE_RATE))!

function setup(
  world: GateWorld,
  outputs: Parameters<typeof makeJudge>[0] = [],
  options: { usage?: JudgeUsage; totalTimeoutMs?: number } = {},
) {
  const fake = createFakeDb(gateQueries(world))
  const judge = makeJudge(outputs, options.usage)
  const gate = { judge: judge.judge, totalTimeoutMs: options.totalTimeoutMs }
  const ctx = { db: fake.db, log: testLog, gate }
  const spend = () => fake.find('insert into "spend_ledger"')
  return { fake, ctx, world, spend, ...judge }
}

function decisionRow(overrides: Partial<Record<keyof GateDecisionRow, unknown>>): GateDecisionRow {
  return {
    id: 'dec-0',
    verdict: 'source_only',
    decided_by: 'model',
    mode: 'live',
    applied: true,
    score: 20,
    config_hash: 'hash',
    prompt_version: GATE_PROMPT_VERSION,
    created_at: new Date('2026-11-16T10:00:00Z'),
    ...overrides,
  } as GateDecisionRow
}

describe('settleJudgement', () => {
  const config = { exploreRate: 0 }
  const rated = (score: number) => ({ score, reasons: [], rationale: '' })

  it('passes a score at the threshold and rejects one below it', () => {
    expect(settleJudgement('item-1', rated(60), 60, config)).toEqual({
      verdict: 'reel',
      decidedBy: 'model',
      score: 60,
    })
    expect(settleJudgement('item-1', rated(50), 60, config)).toMatchObject({
      verdict: 'source_only',
      decidedBy: 'model',
    })
  })

  it('lets a rejected item in the explore sample through, keeping its real score', () => {
    const explore = { ...config, exploreRate: EXPLORE_RATE }
    expect(settleJudgement(EXPLORED_ID, rated(20), 60, explore)).toEqual({
      verdict: 'reel',
      decidedBy: 'explore',
      score: 20,
    })
    expect(settleJudgement(UNEXPLORED_ID, rated(20), 60, explore).decidedBy).toBe('model')
    expect(settleJudgement(EXPLORED_ID, rated(90), 60, explore).decidedBy).toBe('model')
  })
})

describe('retryBlocker', () => {
  const room = { spentUsd: 0.001, nextCallUsd: 0.001, maxCostUsd: 0.01, remainingMs: 10_000 }

  it('allows a retry that fits the cap and the time left', () => {
    expect(retryBlocker(room)).toBeNull()
  })
  it('blocks a retry that would pass the cap, counting what the first call really cost', () => {
    expect(retryBlocker({ ...room, spentUsd: 0.0095 })).toBe('cost_cap')
  })
  it('blocks a retry when the time ceiling has passed', () => {
    expect(retryBlocker({ ...room, remainingMs: 0 })).toBe('time_ceiling')
  })
})

describe('isAdminReelOverride', () => {
  it('is true only for an admin decision that says reel', () => {
    expect(isAdminReelOverride(decisionRow({ decided_by: 'admin', verdict: 'reel' }))).toBe(true)
    expect(isAdminReelOverride(decisionRow({ decided_by: 'admin' }))).toBe(false)
    expect(isAdminReelOverride(decisionRow({ verdict: 'reel' }))).toBe(false)
    expect(isAdminReelOverride(null)).toBe(false)
  })
})

describe('reusableDecision', () => {
  const current = {
    configHash: 'hash',
    mode: 'live' as const,
    since: new Date('2026-11-16T09:00:00Z'),
  }

  it('reuses a decision made in this pass under the same settings', () => {
    const latest = decisionRow({})
    expect(reusableDecision(latest, current)).toBe(latest)
  })

  it('does not reuse across a status change, a settings change, a mode change or an admin row', () => {
    expect(
      reusableDecision(decisionRow({ created_at: new Date('2026-11-16T08:00:00Z') }), current),
    ).toBeNull()
    expect(reusableDecision(decisionRow({ config_hash: 'other' }), current)).toBeNull()
    expect(reusableDecision(decisionRow({ mode: 'shadow' }), current)).toBeNull()
    expect(reusableDecision(decisionRow({ prompt_version: 'gate-v0' }), current)).toBeNull()
    expect(reusableDecision(decisionRow({ decided_by: 'admin' }), current)).toBeNull()
    expect(reusableDecision(decisionRow({ trigger: 'manual' }), current)).toBeNull()
    expect(reusableDecision(decisionRow({}), { ...current, since: null })).toBeNull()
    expect(reusableDecision(null, current)).toBeNull()
  })
})

describe('runGate', () => {
  it('does nothing when the gate is off', async () => {
    const t = setup(makeGateWorld({ settings: { gate_mode: 'off' } }))
    expect(await runGate(t.ctx, gateItem())).toEqual({ kind: 'skipped', reason: 'off' })
    expect(t.judge).not.toHaveBeenCalled()
    expect(t.world.recorded).toHaveLength(0)
    expect(t.fake.find('from "gate_decision"')).toHaveLength(0)
  })

  it('skips a user-requested reel without reading anything', async () => {
    const t = setup(makeGateWorld())
    expect(await runGate(t.ctx, gateItem({ requested: true }))).toEqual({
      kind: 'skipped',
      reason: 'requested',
    })
    expect(t.fake.queries).toHaveLength(0)
  })

  it('never judges an item that was rendered before, even one the judge would reject', async () => {
    const t = setup(makeGateWorld(), [judgeAnswer(0)])
    expect(await runGate(t.ctx, gateItem({ renderedBefore: true }))).toEqual({
      kind: 'skipped',
      reason: 'rendered_before',
    })
    expect(t.fake.queries).toHaveLength(0)
    expect(t.judge).not.toHaveBeenCalled()
    expect(t.world.recorded).toHaveLength(0)
  })

  it('judges a retried item (failed -> found) that was never rendered, ignoring its older decision', async () => {
    const t = setup(
      makeGateWorld({
        latest: decisionRow({ verdict: 'reel', created_at: new Date('2026-11-16T08:00:00Z') }),
      }),
      [judgeAnswer(20)],
    )
    const retried = gateItem({ inStatusSince: new Date('2026-11-16T09:00:00Z') })
    expect(await runGate(t.ctx, retried)).toMatchObject({
      kind: 'decided',
      verdict: 'source_only',
      applied: true,
    })
    expect(t.generate).toHaveBeenCalledTimes(1)
    expect(t.world.recorded).toHaveLength(1)
  })

  it('skips an item whose latest decision is an admin "make a reel anyway"', async () => {
    const t = setup(
      makeGateWorld({ latest: decisionRow({ decided_by: 'admin', verdict: 'reel', score: null }) }),
    )
    expect(await runGate(t.ctx, gateItem())).toEqual({ kind: 'skipped', reason: 'admin_override' })
    expect(t.judge).not.toHaveBeenCalled()
    expect(t.world.recorded).toHaveLength(0)
  })

  it('still skips for an older admin override when a newer manual judgement exists', async () => {
    const t = setup(
      makeGateWorld({
        history: [
          decisionRow({ id: 'dec-admin', decided_by: 'admin', verdict: 'reel', score: null }),
          decisionRow({ id: 'dec-manual', trigger: 'manual', mode: 'shadow', applied: false }),
        ],
      }),
    )
    expect(await runGate(t.ctx, gateItem())).toEqual({ kind: 'skipped', reason: 'admin_override' })
    expect(t.fake.find('from "gate_decision"')[0]!.params).toContain('auto')
    expect(t.judge).not.toHaveBeenCalled()
  })

  it('never reuses a manual judgement as the decision of a pass', async () => {
    const since = new Date(Date.now() - 60_000)
    const world = makeGateWorld({
      latest: decisionRow({
        id: 'dec-manual',
        trigger: 'manual',
        verdict: 'reel',
        created_at: new Date(),
      }),
    })
    const t = setup(world, [judgeAnswer(20)])
    const result = await runGate(t.ctx, gateItem({ inStatusSince: since }))
    expect(result).toMatchObject({ kind: 'decided', decisionId: 'dec-1', verdict: 'source_only' })
    expect(t.generate).toHaveBeenCalledTimes(1)
    expect(world.recorded[0]).toMatchObject({ trigger: 'auto', applied: true })
  })

  it('does not take a manual row for an admin override', () => {
    const manualAdmin = decisionRow({ decided_by: 'admin', verdict: 'reel', trigger: 'manual' })
    expect(isAdminReelOverride(manualAdmin)).toBe(false)
  })

  it('judges again after an admin decision that is not a reel override', async () => {
    const t = setup(makeGateWorld({ latest: decisionRow({ decided_by: 'admin' }) }), [
      judgeAnswer(80),
    ])
    expect(await runGate(t.ctx, gateItem())).toMatchObject({ kind: 'decided', verdict: 'reel' })
  })

  it('records but does not apply a decision in shadow mode', async () => {
    const t = setup(makeGateWorld({ settings: { gate_mode: 'shadow', gate_explore_rate: 0 } }), [
      judgeAnswer(20),
    ])
    const result = await runGate(t.ctx, gateItem())
    expect(result).toMatchObject({ kind: 'decided', verdict: 'source_only', applied: false })
    expect(t.world.recorded[0]).toMatchObject({ mode: 'shadow', applied: false })
  })

  it('passes an item the judge scores above the threshold in live mode', async () => {
    const t = setup(makeGateWorld(), [judgeAnswer(80)])
    const result = await runGate(t.ctx, gateItem())
    expect(result).toEqual({
      kind: 'decided',
      decisionId: 'dec-1',
      verdict: 'reel',
      score: 80,
      decidedBy: 'model',
      applied: true,
    })
    expect(t.judge).toHaveBeenCalledWith('claude-haiku-5-5', 'low')
    expect(t.world.recorded[0]).toMatchObject({
      item_id: 'item-1',
      verdict: 'reel',
      score: 80,
      threshold: 55,
      decided_by: 'model',
      rule: null,
      mode: 'live',
      applied: true,
      model: 'claude-haiku-5-5',
      prompt_version: GATE_PROMPT_VERSION,
      reasons: ['concrete speedup number', 'clear demo'],
    })
    expect(t.world.recorded[0]!.config_hash).toMatch(/^[0-9a-f]{12}$/)
    expect(t.world.recorded[0]!.cost_usd).toBeGreaterThan(0)
  })

  it('uses the judge rating as the score, whatever the legacy weights say', async () => {
    const world = makeGateWorld({
      settings: {
        gate_mode: 'live',
        gate_explore_rate: 0,
        gate_weights: { hook: 10, visual: 0, novelty: 0, audience: 0, clarity: 0, stakes: 0 },
      },
    })
    const t = setup(world, [judgeAnswer(61)])
    expect(await runGate(t.ctx, gateItem())).toMatchObject({ verdict: 'reel', score: 61 })
    expect(world.recorded[0]).toMatchObject({ score: 61, signals: '{}', prompt_version: 'gate-v2' })
  })

  it('rejects an item the judge scores below the threshold and records the spend as gate llm spend', async () => {
    const t = setup(makeGateWorld(), [judgeAnswer(20)])
    const result = await runGate(t.ctx, gateItem())
    expect(result).toMatchObject({ verdict: 'source_only', score: 20, applied: true })
    const spend = t.spend()
    expect(spend).toHaveLength(1)
    expect(spend[0]!.params[0]).toBe('llm')
    const meta = spend[0]!.params.find((p) => typeof p === 'string' && p.includes('"purpose"'))
    expect(JSON.parse(String(meta))).toMatchObject({
      purpose: 'gate',
      model: 'claude-haiku-5-5',
      itemId: 'item-1',
      attempt: 1,
    })
    expect(t.world.recorded[0]!.cost_usd).toBe(Number(spend[0]!.params[2]))
  })

  it('uses the per-source threshold', async () => {
    const t = setup(
      makeGateWorld({
        settings: {
          gate_mode: 'live',
          gate_explore_rate: 0,
          gate_source_rules: { github: { mode: 'judge', threshold: 90 } },
        },
      }),
      [judgeAnswer(80)],
    )
    expect(await runGate(t.ctx, gateItem())).toMatchObject({ verdict: 'source_only', score: 80 })
    expect(t.world.recorded[0]).toMatchObject({ threshold: 90 })
  })

  it.each([
    ['always_reel', { mode: 'always_reel' }, 'reel'],
    ['always_source_only', { mode: 'always_source_only' }, 'source_only'],
    ['below_min_item_score', { mode: 'judge', minItemScore: 0.9 }, 'source_only'],
  ] as const)(
    'settles by the %s rule without calling the model',
    async (rule, sourceRule, verdict) => {
      const t = setup(
        makeGateWorld({
          settings: {
            gate_mode: 'live',
            gate_explore_rate: EXPLORE_RATE,
            gate_source_rules: { github: sourceRule },
          },
        }),
      )
      const result = await runGate(t.ctx, gateItem({ itemId: EXPLORED_ID }))
      expect(result).toMatchObject({ kind: 'decided', verdict, decidedBy: 'rule', score: null })
      expect(t.judge).not.toHaveBeenCalled()
      expect(t.spend()).toHaveLength(0)
      expect(t.world.recorded[0]).toMatchObject({
        decided_by: 'rule',
        rule,
        model: null,
        cost_usd: 0,
      })
    },
  )

  it('explores a rejected item as a reel but keeps what the judge thought', async () => {
    const world = makeGateWorld({
      settings: { gate_mode: 'live', gate_explore_rate: EXPLORE_RATE },
    })
    const t = setup(world, [judgeAnswer(20), judgeAnswer(20)])
    const explored = await runGate(t.ctx, gateItem({ itemId: EXPLORED_ID }))
    expect(explored).toMatchObject({ verdict: 'reel', decidedBy: 'explore', score: 20 })
    expect(world.recorded[0]).toMatchObject({
      verdict: 'reel',
      decided_by: 'explore',
      score: 20,
      reasons: ['concrete speedup number', 'clear demo'],
      rationale: 'It has a checkable result and something to show.',
    })
    expect(world.recorded[0]!.signals).toBe('{}')

    const rejected = await runGate(t.ctx, gateItem({ itemId: UNEXPLORED_ID }))
    expect(rejected).toMatchObject({ verdict: 'source_only', decidedBy: 'model' })
  })

  it('shows the judge the instructions, the labelled examples and the item', async () => {
    const t = setup(
      makeGateWorld({
        settings: {
          gate_mode: 'live',
          gate_explore_rate: 0,
          gate_example_count: 2,
          gate_instructions: `Only reels with a demo. ${'Be strict. '.repeat(12)}`,
        },
        examples: [gateExampleRow(1), gateExampleRow(2)],
      }),
      [judgeAnswer(80)],
    )
    await runGate(t.ctx, gateItem())
    const request = t.generate.mock.calls[0]![0]
    expect(request.system).toContain('Only reels with a demo.')
    expect(request.system).toContain(
      '- title: "Example source 1" | source: hn | should have been: a reel',
    )
    expect(request.user).toContain('Title: acme/repo')
    expect(t.fake.find('with labelled')[0]!.params).toContain(2)
  })

  it('shows the judge the account winners and losers from Instagram', async () => {
    const t = setup(makeGateWorld({ performance: performanceRows() }), [judgeAnswer(80)])
    await runGate(t.ctx, gateItem())
    const system = t.generate.mock.calls[0]![0].system
    expect(system).toContain('- title: "Posted reel 0" | source: reddit | did well: 10x the usual')
    expect(system).toContain(
      '- title: "Posted reel 19" | source: reddit | did poorly: 0.1x the usual',
    )
    expect(system).not.toContain('Posted reel 8')
    expect(system.match(/x the usual/g)).toHaveLength(8)
  })

  it('shows no results when the setting is 0, without reading them', async () => {
    const world = makeGateWorld({
      settings: { gate_mode: 'live', gate_explore_rate: 0, gate_performance_examples: 0 },
      performance: performanceRows(),
    })
    const t = setup(world, [judgeAnswer(80)])
    await runGate(t.ctx, gateItem())
    expect(t.generate.mock.calls[0]![0].system).not.toContain('</performance>')
    expect(t.fake.find('from instagram_post')).toHaveLength(0)
  })

  it('never shows the judged item its own result, nor repeats an admin-labelled item', async () => {
    const world = makeGateWorld({
      performance: performanceRows(),
      examples: [gateExampleRow(1, { item_id: 'post-1', title: 'Posted reel 1' })],
    })
    const t = setup(world, [judgeAnswer(80)])
    await runGate(t.ctx, gateItem({ itemId: 'post-0' }))
    const system = t.generate.mock.calls[0]![0].system
    const blockStart = system.indexOf('<performance>\n')
    const performance = system.slice(blockStart)
    expect(performance).not.toContain('"Posted reel 0"')
    expect(performance).not.toContain('"Posted reel 1"')
    expect(performance).toContain('"Posted reel 2"')
    expect(system.slice(0, blockStart)).toContain('"Posted reel 1"')
  })

  it('judges without results when the Instagram lookup fails', async () => {
    const world = makeGateWorld({ performance: performanceRows(), failOn: 'from instagram_post' })
    const t = setup(world, [judgeAnswer(80)])
    expect(await runGate(t.ctx, gateItem())).toMatchObject({ kind: 'decided', verdict: 'reel' })
    expect(t.generate.mock.calls[0]![0].system).not.toContain('</performance>')
    expect(world.recorded).toHaveLength(1)
  })

  it('shows no results until the account has enough measured posts', async () => {
    const world = makeGateWorld({ performance: performanceRows().slice(0, 11) })
    const t = setup(world, [judgeAnswer(80)])
    await runGate(t.ctx, gateItem())
    expect(t.generate.mock.calls[0]![0].system).not.toContain('</performance>')
  })

  it('retries a malformed answer once and charges both calls to the decision', async () => {
    const t = setup(makeGateWorld(), ['not json at all', judgeAnswer(80)])
    expect(await runGate(t.ctx, gateItem())).toMatchObject({ kind: 'decided', verdict: 'reel' })
    expect(t.generate).toHaveBeenCalledTimes(2)
    const costs = t.spend().map((q) => Number(q.params[2]))
    expect(costs).toHaveLength(2)
    expect(t.world.recorded[0]!.cost_usd).toBeCloseTo(costs[0]! + costs[1]!, 10)
  })

  it('fails open when the answer is still malformed after the retry', async () => {
    const t = setup(makeGateWorld(), ['nope', '{"reasons": ["no score here"]}'])
    expect(await runGate(t.ctx, gateItem())).toEqual({ kind: 'skipped', reason: 'error' })
    expect(t.generate).toHaveBeenCalledTimes(2)
    expect(t.spend()).toHaveLength(2)
    expect(t.world.recorded).toHaveLength(0)
  })

  it('does not retry a malformed answer when the retry would break the cost cap', async () => {
    const world = makeGateWorld({
      settings: {
        gate_mode: 'live',
        gate_explore_rate: 0,
        gate_model: 'claude-sonnet-5-5',
        gate_max_cost_usd_per_item: 0.012,
      },
    })
    const t = setup(world, ['not json', judgeAnswer(80)], {
      usage: { inputTokens: 2000, outputTokens: 600 },
    })
    expect(await runGate(t.ctx, gateItem())).toEqual({ kind: 'skipped', reason: 'error' })
    expect(t.generate).toHaveBeenCalledTimes(1)
    expect(t.spend()).toHaveLength(1)
    expect(world.recorded).toHaveLength(0)
  })

  it('skips the judge and fails open when one call cannot fit the cap at the model price', async () => {
    const world = makeGateWorld({
      settings: { gate_mode: 'live', gate_explore_rate: 0, gate_model: 'claude-opus-5-5' },
    })
    const t = setup(world, [judgeAnswer(20)])
    expect(await runGate(t.ctx, gateItem())).toEqual({ kind: 'skipped', reason: 'over_budget' })
    expect(t.judge).not.toHaveBeenCalled()
    expect(t.spend()).toHaveLength(0)
    expect(world.recorded).toHaveLength(0)
  })

  it('still settles by rule when the model does not fit the cap', async () => {
    const world = makeGateWorld({
      settings: {
        gate_mode: 'live',
        gate_model: 'claude-opus-5-5',
        gate_source_rules: { github: { mode: 'always_source_only' } },
      },
    })
    const t = setup(world)
    expect(await runGate(t.ctx, gateItem())).toMatchObject({ verdict: 'source_only' })
  })

  it('judges on Sonnet under the default cap with a shorter excerpt', async () => {
    const world = makeGateWorld({
      settings: { gate_mode: 'live', gate_explore_rate: 0, gate_model: 'claude-sonnet-5-5' },
    })
    const t = setup(world, [judgeAnswer(80)])
    const evidence = Array.from({ length: 40 }, () => 'word '.repeat(200))
    expect(await runGate(t.ctx, gateItem({ evidence }))).toMatchObject({ verdict: 'reel' })
    const request = t.generate.mock.calls[0]![0]
    expect(request.user.length).toBeLessThan(6000)
    const estimate = gateCallCostUsd(
      'claude-sonnet-5-5',
      request.system.length + request.user.length,
    )
    expect(estimate).toBeLessThanOrEqual(0.01)
  })

  it('fails open fast when the judge never answers', async () => {
    const t = setup(makeGateWorld(), [NEVER_ANSWERS], { totalTimeoutMs: 30 })
    const startedAt = Date.now()
    expect(await runGate(t.ctx, gateItem())).toEqual({ kind: 'skipped', reason: 'error' })
    expect(Date.now() - startedAt).toBeLessThan(1000)
    expect(t.generate).toHaveBeenCalledTimes(1)
    expect(t.world.recorded).toHaveLength(0)
  })

  it('gives the retry only the time left under the ceiling', async () => {
    const t = setup(makeGateWorld(), ['not json', NEVER_ANSWERS], { totalTimeoutMs: 40 })
    expect(await runGate(t.ctx, gateItem())).toEqual({ kind: 'skipped', reason: 'error' })
    expect(t.generate).toHaveBeenCalledTimes(2)
  })

  it('treats an SDK timeout as a gate failure, not a quota error', async () => {
    const timeout = new Anthropic.APIConnectionTimeoutError({ message: 'Request timed out.' })
    expect(asClaudeQuotaError(timeout)).toBe(timeout)
    const t = setup(makeGateWorld(), [timeout])
    expect(await runGate(t.ctx, gateItem())).toEqual({ kind: 'skipped', reason: 'error' })
  })

  it('fails open when the judge call errors', async () => {
    const t = setup(makeGateWorld(), [new Error('claude 529 overloaded')])
    expect(await runGate(t.ctx, gateItem())).toEqual({ kind: 'skipped', reason: 'error' })
    expect(t.world.recorded).toHaveLength(0)
  })

  it.each([
    ['the settings cannot be loaded', 'from "app_setting"'],
    ['the latest decision cannot be read', 'from "gate_decision"'],
    ['the decision cannot be stored', 'insert into "gate_decision"'],
  ])('fails open when %s', async (_name, failOn) => {
    const t = setup(makeGateWorld({ failOn }), [judgeAnswer(20)])
    expect(await runGate(t.ctx, gateItem())).toEqual({ kind: 'skipped', reason: 'error' })
  })

  it('does not swallow a quota error, so the pipeline still pauses', async () => {
    const quota = new QuotaExhaustedError(402, 'Claude HTTP 402: credit balance too low')
    const t = setup(makeGateWorld(), [quota])
    await expect(runGate(t.ctx, gateItem())).rejects.toBe(quota)
    expect(t.world.recorded).toHaveLength(0)
  })

  it('reuses the decision of this pass on a redelivery instead of judging twice', async () => {
    const since = new Date(Date.now() - 60_000)
    const t = setup(makeGateWorld(), [judgeAnswer(20)])
    const first = await runGate(t.ctx, gateItem({ inStatusSince: since }))
    const second = await runGate(t.ctx, gateItem({ inStatusSince: since }))
    expect(second).toEqual(first)
    expect(t.generate).toHaveBeenCalledTimes(1)
    expect(t.world.recorded).toHaveLength(1)
  })
})
