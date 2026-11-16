import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleMessage, type MessageLike } from '../src/pipeline/consumer'
import { processItem } from '../src/pipeline/process'
import { QuotaExhaustedError } from '../src/pipeline/quota'
import { gateQueries, judgeAnswer, makeGateWorld, makeJudge, type GateWorld } from './helpers/gate'
import { useFetch } from './helpers/mock-fetch'
import {
  ITEM_ID,
  makeDeps,
  makeWorld,
  transitionTargets,
  validOutput,
  type World,
} from './helpers/process-deps'

beforeEach(() => {
  useFetch()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

function setup(
  gateWorld: GateWorld,
  judgeOutputs: (string | Error)[],
  scriptOutputs: (string | Error)[] = [validOutput()],
  world: World = makeWorld(),
) {
  const judge = makeJudge(judgeOutputs)
  const t = makeDeps(world, scriptOutputs, gateQueries(gateWorld))
  t.deps.gate = { judge: judge.judge }
  const gateSpend = () =>
    t.fake
      .find('insert into "spend_ledger"')
      .filter((q) => q.params.some((p) => typeof p === 'string' && p.includes('"purpose":"gate"')))
  return { ...t, gateWorld, judge: judge.judge, judgeGenerate: judge.generate, gateSpend }
}

describe('processItem with the gate', () => {
  it('live mode: a rejected item ends source_only with its chunks embedded and no script', async () => {
    const t = setup(makeGateWorld(), [judgeAnswer(20)])
    const outcome = await processItem(t.deps, ITEM_ID, 1)

    expect(outcome).toBe('source_only')
    expect(transitionTargets(t.fake.queries)).toEqual(['source_only'])
    expect(t.generate).not.toHaveBeenCalled()
    expect(t.send).not.toHaveBeenCalled()
    expect(t.judgeGenerate).toHaveBeenCalledTimes(1)
    expect(t.gateSpend()).toHaveLength(1)
    expect(t.gateSpend()[0]!.params[0]).toBe('llm')

    expect(t.gateWorld.recorded).toHaveLength(1)
    expect(t.gateWorld.recorded[0]).toMatchObject({
      item_id: ITEM_ID,
      verdict: 'source_only',
      mode: 'live',
      applied: true,
    })

    expect(t.embed).toHaveBeenCalledTimes(2)
    expect(t.embed.mock.calls[0]![0]).toHaveLength(2)
    const itemText = t.embed.mock.calls[1]![0][0]!
    expect(itemText).toContain('acme/repo')
    expect(itemText).toContain('A fast queue library for Cloudflare Workers.')
    expect(t.fake.find('update evidence_chunk c set embedding')).toHaveLength(1)
    expect(t.fake.find('update item set embedding')).toHaveLength(1)

    const event = t.fake.find('insert into "item_event"').at(-1)!
    const meta = event.params.find((p) => typeof p === 'string' && p.includes('decisionId'))
    expect(JSON.parse(String(meta))).toMatchObject({
      verdict: 'source_only',
      score: 20,
      decisionId: 'dec-1',
      decidedBy: 'model',
      chunksEmbedded: 2,
    })
    expect(t.world.queuedAt).toBeNull()
    expect(t.fake.find('"visibility"')).toHaveLength(0)
    expect(t.fake.find('"script" =')).toHaveLength(0)
  })

  it('live mode: a reel requested while the gate was judging wins; the verdict is recorded as not applied', async () => {
    const judge = makeJudge([judgeAnswer(20)])
    const gateWorld = makeGateWorld()
    const gate = gateQueries(gateWorld)
    const t = makeDeps(makeWorld(), [validOutput()], (q) => {
      if (q.sql.includes('for update')) return [{ owner_id: null, priority_at: new Date() }]
      return gate(q)
    })
    t.deps.gate = { judge: judge.judge }

    expect(await processItem(t.deps, ITEM_ID, 1)).toBe('rendered_enqueued')
    expect(transitionTargets(t.fake.queries)).toEqual(['summarized', 'embedded'])
    expect(t.generate).toHaveBeenCalledTimes(1)
    expect(gateWorld.recorded[0]).toMatchObject({ verdict: 'source_only', applied: true })
    const unapply = t.fake.find('update "gate_decision" set "applied"')
    expect(unapply).toHaveLength(1)
    expect(unapply[0]!.params).toEqual([false, 'dec-1'])
  })

  it('live mode: the reject re-checks for a request under a row lock before it transitions', async () => {
    const t = setup(makeGateWorld(), [judgeAnswer(20)])
    await processItem(t.deps, ITEM_ID, 1)
    const lock = t.fake.queries.findIndex((q) => q.sql.includes('for update'))
    const transition = t.fake.queries.findIndex((q) =>
      q.sql.startsWith('update "item" set "status"'),
    )
    expect(lock).toBeGreaterThan(-1)
    expect(lock).toBeLessThan(transition)
    expect(t.fake.queries[lock]!.sql).toContain('"owner_id", "priority_at"')
  })

  it('live mode: a passed item carries on to its script and render', async () => {
    const t = setup(makeGateWorld(), [judgeAnswer(80)])
    expect(await processItem(t.deps, ITEM_ID, 1)).toBe('rendered_enqueued')
    expect(transitionTargets(t.fake.queries)).toEqual(['summarized', 'embedded'])
    expect(t.generate).toHaveBeenCalledTimes(1)
    expect(t.gateWorld.recorded[0]).toMatchObject({ verdict: 'reel', applied: true })
  })

  it('shadow mode: a rejected item still gets its script, and the decision is recorded', async () => {
    const t = setup(makeGateWorld({ settings: { gate_mode: 'shadow', gate_explore_rate: 0 } }), [
      judgeAnswer(20),
    ])
    expect(await processItem(t.deps, ITEM_ID, 1)).toBe('rendered_enqueued')
    expect(transitionTargets(t.fake.queries)).toEqual(['summarized', 'embedded'])
    expect(t.generate).toHaveBeenCalledTimes(1)
    expect(t.send).toHaveBeenCalledTimes(1)
    expect(t.gateWorld.recorded).toHaveLength(1)
    expect(t.gateWorld.recorded[0]).toMatchObject({
      verdict: 'source_only',
      mode: 'shadow',
      applied: false,
    })
    expect(t.gateSpend()).toHaveLength(1)
  })

  it('gate off: no judge call and no decision row', async () => {
    const t = setup(makeGateWorld({ settings: { gate_mode: 'off' } }), [])
    expect(await processItem(t.deps, ITEM_ID, 1)).toBe('rendered_enqueued')
    expect(t.judge).not.toHaveBeenCalled()
    expect(t.gateWorld.recorded).toHaveLength(0)
  })

  it('fails open: a judge error sends the item to its script as if the gate were off', async () => {
    const t = setup(makeGateWorld(), [new Error('claude 529 overloaded')])
    expect(await processItem(t.deps, ITEM_ID, 1)).toBe('rendered_enqueued')
    expect(transitionTargets(t.fake.queries)).toEqual(['summarized', 'embedded'])
    expect(t.gateWorld.recorded).toHaveLength(0)
  })

  it('a quota error from the judge pauses the pipeline instead of failing open', async () => {
    const t = setup(makeGateWorld(), [new QuotaExhaustedError(402, 'Claude HTTP 402: credits')])
    const message: MessageLike = {
      id: 'msg-1',
      body: { itemId: ITEM_ID, attempt: 0 },
      attempts: 1,
      ack: vi.fn(),
      retry: vi.fn(),
    }
    expect(await handleMessage(t.deps, message)).toBe('paused')
    expect(t.generate).not.toHaveBeenCalled()
    expect(transitionTargets(t.fake.queries)).toEqual([])
    expect(message.ack).toHaveBeenCalledTimes(1)
  })

  it('an admin override back to found is not judged again and re-inserts chunks without conflict', async () => {
    const t = setup(
      makeGateWorld({
        latest: { id: 'dec-admin', decided_by: 'admin', verdict: 'reel', mode: 'live' },
      }),
      [],
    )
    expect(await processItem(t.deps, ITEM_ID, 1)).toBe('rendered_enqueued')
    expect(t.judge).not.toHaveBeenCalled()
    expect(t.gateWorld.recorded).toHaveLength(0)
    expect(t.generate).toHaveBeenCalledTimes(1)
    const insert = t.fake.find('insert into "evidence_chunk"')[0]!
    expect(insert.sql).toContain('on conflict ("mention_id", "chunk_index") do nothing')
    expect(t.fake.find('embedding is null')).toHaveLength(1)
  })

  it('live mode: a reel that was rendered before is reprocessed without being judged', async () => {
    const world = makeWorld({ renderedAt: new Date('2026-11-10T10:00:00Z') })
    const t = setup(makeGateWorld(), [judgeAnswer(0)], [validOutput()], world)
    expect(await processItem(t.deps, ITEM_ID, 1)).toBe('rendered_enqueued')
    expect(transitionTargets(t.fake.queries)).toEqual(['summarized', 'embedded'])
    expect(t.judge).not.toHaveBeenCalled()
    expect(t.judgeGenerate).not.toHaveBeenCalled()
    expect(t.gateWorld.recorded).toHaveLength(0)
    expect(t.gateSpend()).toHaveLength(0)
    expect(t.fake.find('"key" in')).toHaveLength(0)
    expect(t.generate).toHaveBeenCalledTimes(1)
    expect(t.send).toHaveBeenCalledTimes(1)
  })

  it('live mode: a never-rendered item back in found is gated as usual', async () => {
    const t = setup(makeGateWorld(), [judgeAnswer(20)], [], makeWorld({ renderedAt: null }))
    expect(await processItem(t.deps, ITEM_ID, 1)).toBe('source_only')
    expect(t.judgeGenerate).toHaveBeenCalledTimes(1)
    expect(t.gateWorld.recorded).toHaveLength(1)
  })

  it('a source_only item delivered again is skipped untouched', async () => {
    const t = setup(makeGateWorld(), [], [], makeWorld({ status: 'source_only' }))
    expect(await processItem(t.deps, ITEM_ID, 1)).toBe('skipped_stale')
    expect(t.judge).not.toHaveBeenCalled()
    expect(t.embed).not.toHaveBeenCalled()
  })
})
