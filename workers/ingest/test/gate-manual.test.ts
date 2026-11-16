import { describe, expect, it, vi } from 'vitest'
import { shouldExplore } from '@reelset/core'
import {
  MANUAL_JUDGE_PATH,
  handleManualJudge,
  judgeItemManually,
  manualJudgeFailure,
} from '../src/pipeline/gate-manual'
import { GateBudgetError, GateJudgeError, GateTimeoutError } from '../src/pipeline/gate'
import { QuotaExhaustedError } from '../src/pipeline/quota'
import { createFakeDb, type RecordedQuery } from './helpers/fake-db'
import {
  NEVER_ANSWERS,
  gateQueries,
  judgeAnswer,
  makeGateWorld,
  makeJudge,
  type GateWorld,
} from './helpers/gate'
import { testLog } from './helpers/mock-fetch'

const EXPLORE_RATE = 0.5
const uuid = (n: number) => `9e1c2b0a-0000-4000-8000-${String(n).padStart(12, '0')}`
const ITEM_ID = Array.from({ length: 200 }, (_, i) => uuid(i)).find((id) =>
  shouldExplore(id, EXPLORE_RATE),
)!

type ItemWorld = {
  item: Record<string, unknown> | null
  mentions: Record<string, unknown>[]
  chunks: { text: string }[]
}

function makeItemWorld(overrides: Partial<ItemWorld> = {}): ItemWorld {
  return {
    item: {
      id: ITEM_ID,
      title: 'acme/repo',
      kind: 'repo',
      canonical_key: 'github:acme/repo',
      score: 0.8,
      images: [{ url: 'https://example.com/a.png', kind: 'og' }],
      demo: { url: 'https://example.com/demo.mp4' },
    },
    mentions: [
      { source: 'github', score: 1200, num_comments: 30, published_at: '2026-11-10T00:00:00Z' },
    ],
    chunks: [
      { text: 'A fast queue library for Cloudflare Workers.' },
      { text: 'Retries built in.' },
    ],
    ...overrides,
  }
}

function setup(
  gateWorld: GateWorld,
  outputs: Parameters<typeof makeJudge>[0] = [],
  itemWorld: ItemWorld = makeItemWorld(),
  totalTimeoutMs?: number,
) {
  const gate = gateQueries(gateWorld)
  const fake = createFakeDb((q: RecordedQuery) => {
    if (q.sql.includes('from "item"')) return itemWorld.item ? [itemWorld.item] : []
    if (q.sql.includes('from "mention"')) return itemWorld.mentions
    if (q.sql.includes('from "evidence_chunk"')) return itemWorld.chunks
    return gate(q)
  })
  const judge = makeJudge(outputs)
  const deps = { db: fake.db, log: testLog, gate: { judge: judge.judge, totalTimeoutMs } }
  const writes = () =>
    fake.queries.filter((q) => /^(update|delete|insert)/.test(q.sql)).map((q) => q.sql)
  return { fake, deps, gateWorld, writes, ...judge }
}

const post = (body: unknown) =>
  new Request(`https://ingest.test${MANUAL_JUDGE_PATH}`, {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

describe('judgeItemManually', () => {
  it('judges an item from its stored evidence and records a manual, never-applied decision', async () => {
    const t = setup(makeGateWorld(), [judgeAnswer(2)])
    const row = await judgeItemManually(t.deps, ITEM_ID)

    expect(row).toMatchObject({
      item_id: ITEM_ID,
      verdict: 'source_only',
      score: 20,
      decided_by: 'model',
      trigger: 'manual',
      mode: 'shadow',
      applied: false,
      model: 'claude-haiku-5-5',
    })
    const request = t.generate.mock.calls[0]![0]
    expect(request.user).toContain('Title: acme/repo')
    expect(request.user).toContain('Engagement: github score 1200 30 comments')
    expect(request.user).toContain('Visuals: 1 usable image, a demo recording')
    expect(request.user).toContain('A fast queue library for Cloudflare Workers.')
  })

  it('changes nothing but the decision and spend tables: no transition, no embedding, no queue', async () => {
    const t = setup(makeGateWorld(), [judgeAnswer(2)])
    await judgeItemManually(t.deps, ITEM_ID)
    const writes = t.writes()
    expect(writes).toHaveLength(2)
    expect(writes[0]).toMatch(/^insert into "spend_ledger"/)
    expect(writes[1]).toMatch(/^insert into "gate_decision"/)
    expect(t.fake.queries.some((q) => q.sql.includes('for update'))).toBe(false)
  })

  it('records the spend as gate llm spend with a manual trigger', async () => {
    const t = setup(makeGateWorld(), [judgeAnswer(8)])
    await judgeItemManually(t.deps, ITEM_ID)
    const spend = t.fake.find('insert into "spend_ledger"')[0]!
    expect(spend.params[0]).toBe('llm')
    const meta = spend.params.find((p) => typeof p === 'string' && p.includes('"purpose"'))
    expect(JSON.parse(String(meta))).toMatchObject({
      purpose: 'gate',
      trigger: 'manual',
      itemId: ITEM_ID,
    })
  })

  it('judges even when the gate is off', async () => {
    const t = setup(makeGateWorld({ settings: { gate_mode: 'off' } }), [judgeAnswer(8)])
    expect(await judgeItemManually(t.deps, ITEM_ID)).toMatchObject({
      verdict: 'reel',
      mode: 'shadow',
      applied: false,
    })
  })

  it('never explores: an item in the explore sample keeps its real verdict', async () => {
    const t = setup(
      makeGateWorld({ settings: { gate_mode: 'live', gate_explore_rate: EXPLORE_RATE } }),
      [judgeAnswer(2)],
    )
    expect(await judgeItemManually(t.deps, ITEM_ID)).toMatchObject({
      verdict: 'source_only',
      decided_by: 'model',
    })
  })

  it('records the same config hash an automatic decision would, despite not exploring', async () => {
    const settings = { gate_mode: 'live', gate_explore_rate: EXPLORE_RATE }
    const a = setup(makeGateWorld({ settings }), [judgeAnswer(8)])
    const b = setup(makeGateWorld({ settings: { ...settings, gate_explore_rate: 0 } }), [
      judgeAnswer(8),
    ])
    const [rowA, rowB] = [
      await judgeItemManually(a.deps, ITEM_ID),
      await judgeItemManually(b.deps, ITEM_ID),
    ]
    expect(rowA.config_hash).not.toBe(rowB.config_hash)
  })

  it('ignores the exemptions: a rendered, requested, admin-overridden item is still judged', async () => {
    const item = {
      ...makeItemWorld().item,
      status: 'rendered',
      rendered_at: new Date(),
      owner_id: 'user-1',
      priority_at: new Date(),
    }
    const world = makeGateWorld({
      latest: { id: 'dec-admin', decided_by: 'admin', verdict: 'reel', mode: 'live' },
    })
    const t = setup(world, [judgeAnswer(2)], makeItemWorld({ item }))
    expect(await judgeItemManually(t.deps, ITEM_ID)).toMatchObject({ verdict: 'source_only' })
    expect(t.fake.find('from "gate_decision"')).toHaveLength(0)
    expect(t.writes().some((sql) => sql.startsWith('update'))).toBe(false)
  })

  it('answers by source rule without calling the model', async () => {
    const world = makeGateWorld({
      settings: { gate_mode: 'live', gate_source_rules: { github: { mode: 'always_reel' } } },
    })
    const t = setup(world)
    expect(await judgeItemManually(t.deps, ITEM_ID)).toMatchObject({
      verdict: 'reel',
      decided_by: 'rule',
      rule: 'always_reel',
      trigger: 'manual',
      cost_usd: 0,
    })
    expect(t.judge).not.toHaveBeenCalled()
  })

  it('treats a youtube item with stored text as having a transcript', async () => {
    const item = { ...makeItemWorld().item, canonical_key: 'youtube:abc', images: null, demo: null }
    const t = setup(makeGateWorld(), [judgeAnswer(8)], makeItemWorld({ item }))
    await judgeItemManually(t.deps, ITEM_ID)
    expect(t.generate.mock.calls[0]![0].user).toContain('Visuals: a video with a transcript')
  })

  it('judges again on a second call and records a second row', async () => {
    const t = setup(makeGateWorld(), [judgeAnswer(2), judgeAnswer(8)])
    const [first, second] = await Promise.all([
      judgeItemManually(t.deps, ITEM_ID),
      judgeItemManually(t.deps, ITEM_ID),
    ])
    expect(first.id).not.toBe(second.id)
    expect(t.gateWorld.recorded).toHaveLength(2)
  })

  it('fails with item_not_found and no_evidence instead of guessing', async () => {
    const missing = setup(makeGateWorld(), [], makeItemWorld({ item: null }))
    await expect(judgeItemManually(missing.deps, ITEM_ID)).rejects.toMatchObject({
      code: 'item_not_found',
    })
    const bare = setup(makeGateWorld(), [], makeItemWorld({ chunks: [] }))
    await expect(judgeItemManually(bare.deps, ITEM_ID)).rejects.toMatchObject({
      code: 'no_evidence',
    })
    expect(bare.judge).not.toHaveBeenCalled()
    expect(bare.gateWorld.recorded).toHaveLength(0)
  })

  it('does not fail open: judge errors, quota errors and timeouts are thrown and nothing is recorded', async () => {
    const quota = new QuotaExhaustedError(402, 'Claude HTTP 402: credits')
    const failing = setup(makeGateWorld(), [new Error('claude 529')])
    await expect(judgeItemManually(failing.deps, ITEM_ID)).rejects.toThrow('claude 529')
    const broke = setup(makeGateWorld(), [quota])
    await expect(judgeItemManually(broke.deps, ITEM_ID)).rejects.toBe(quota)
    const slow = setup(makeGateWorld(), [NEVER_ANSWERS], makeItemWorld(), 30)
    await expect(judgeItemManually(slow.deps, ITEM_ID)).rejects.toBeInstanceOf(GateTimeoutError)
    const garbled = setup(makeGateWorld(), ['nope', 'still nope'])
    await expect(judgeItemManually(garbled.deps, ITEM_ID)).rejects.toBeInstanceOf(GateJudgeError)
    for (const t of [failing, broke, slow, garbled]) expect(t.gateWorld.recorded).toHaveLength(0)
    expect(broke.fake.find('pipeline_paused')).toHaveLength(0)
  })
})

describe('manualJudgeFailure', () => {
  it('names each failure', () => {
    expect(manualJudgeFailure(new GateBudgetError('claude-opus-5-5', 0.01, 0.02)).code).toBe(
      'over_budget',
    )
    expect(manualJudgeFailure(new QuotaExhaustedError(402, 'x')).code).toBe('quota_exhausted')
    expect(manualJudgeFailure(new GateTimeoutError(10)).code).toBe('judge_timeout')
    expect(manualJudgeFailure(new GateJudgeError('bad')).code).toBe('judge_failed')
    expect(manualJudgeFailure(new Error('db down'))).toEqual({
      code: 'internal_error',
      message: 'The judge call failed',
    })
  })
})

describe('handleManualJudge', () => {
  it('returns the recorded decision', async () => {
    const t = setup(makeGateWorld(), [judgeAnswer(8)])
    const res = await handleManualJudge(post({ itemId: ITEM_ID }), t.deps)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      ok: true,
      decision: {
        id: 'dec-1',
        itemId: ITEM_ID,
        verdict: 'reel',
        score: 80,
        threshold: 55,
        decidedBy: 'model',
        rule: null,
        model: 'claude-haiku-5-5',
        trigger: 'manual',
        mode: 'shadow',
        applied: false,
        reasons: ['concrete speedup number', 'clear demo'],
      },
    })
  })

  it.each([['not json'], [{}], [{ itemId: 'item-1' }], [{ itemId: 7 }]])(
    'rejects an invalid body %j with 400 before touching the database',
    async (body) => {
      const t = setup(makeGateWorld(), [judgeAnswer(8)])
      const res = await handleManualJudge(post(body), t.deps)
      expect(res.status).toBe(400)
      expect(await res.json()).toMatchObject({ ok: false, error: { code: 'invalid_request' } })
      expect(t.fake.queries).toHaveLength(0)
    },
  )

  it('maps each failure to its status and code', async () => {
    const cases = [
      [setup(makeGateWorld(), [], makeItemWorld({ item: null })), 404, 'item_not_found'],
      [setup(makeGateWorld(), [], makeItemWorld({ chunks: [] })), 422, 'no_evidence'],
      [
        setup(makeGateWorld({ settings: { gate_model: 'claude-opus-5-5' } }), [judgeAnswer(8)]),
        422,
        'over_budget',
      ],
      [setup(makeGateWorld(), [new QuotaExhaustedError(402, 'x')]), 503, 'quota_exhausted'],
      [setup(makeGateWorld(), [NEVER_ANSWERS], makeItemWorld(), 30), 504, 'judge_timeout'],
      [setup(makeGateWorld(), ['nope', 'nope']), 502, 'judge_failed'],
      [
        setup(makeGateWorld({ failOn: 'insert into "gate_decision"' }), [judgeAnswer(8)]),
        500,
        'internal_error',
      ],
    ] as const
    for (const [t, status, code] of cases) {
      const res = await handleManualJudge(post({ itemId: ITEM_ID }), t.deps)
      expect([res.status, ((await res.json()) as { error: { code: string } }).error.code]).toEqual([
        status,
        code,
      ])
    }
  })
})

describe(`POST ${MANUAL_JUDGE_PATH}`, () => {
  it('requires the internal bearer token and POST', async () => {
    vi.resetModules()
    const createDb = vi.fn(() => ({ db: {}, close: async () => {} }))
    vi.doMock('@reelset/core', async (importOriginal) => ({
      ...(await importOriginal<typeof import('@reelset/core')>()),
      createDb,
    }))
    const { default: worker } = await import('../src/index')
    const env = { SELFCHECK_TOKEN: 'secret', HYPERDRIVE: { connectionString: 'x' } }
    const call = (method: string, headers: Record<string, string>) =>
      worker.fetch!(
        new Request(`https://ingest.test${MANUAL_JUDGE_PATH}`, {
          method,
          headers,
          ...(method === 'POST' ? { body: '{}' } : {}),
        }),
        env as never,
        { waitUntil: () => {} } as never,
      )
    expect((await call('POST', {})).status).toBe(401)
    expect((await call('POST', { authorization: 'Bearer nope' })).status).toBe(401)
    expect((await call('GET', { authorization: 'Bearer secret' })).status).toBe(405)
    expect(createDb).not.toHaveBeenCalled()
    const res = await call('POST', { authorization: 'Bearer secret' })
    expect(res.status).toBe(400)
    expect(createDb).toHaveBeenCalledTimes(1)
    vi.doUnmock('@reelset/core')
  })
})
