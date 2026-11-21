import { createLogger } from '@reelset/core'
import type { CompiledQuery } from 'kysely'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { JudgeOutcome } from '@/lib/admin/gate-judge'
import { checkLink, findItemByReference, judgeItemNow, requestGateJudgement } from './gate-judge'
import { scriptedDb, sqlHas, type Scripted } from './scripted-db'

const log = createLogger({ app: 'test', level: 'silent' })
const ITEM = '1a2b3c4d-2222-4333-8444-555555555555'
const item = { id: ITEM, title: 'acme/repo', status: 'rendered', source: 'github' }
const decision = { id: 'd1', verdict: 'source_only' as const, score: 41, threshold: 55 }
const judgement = {
  id: 'd1',
  item_id: ITEM,
  verdict: 'source_only',
  score: 41,
  threshold: 55,
  signals: { hook: 3 },
  reasons: ['routine release'],
  rationale: '',
  decided_by: 'model',
  rule: null,
  mode: 'shadow',
  applied: false,
  trigger: 'manual',
  model: 'claude-haiku-5-5',
  prompt_version: 'gate-v1',
  config_hash: 'h',
  cost_usd: 0.001,
  label: null,
  label_reason: null,
  label_note: null,
  labeled_by: null,
  labeled_at: null,
  created_at: new Date('2026-11-15T10:00:00Z'),
}

describe('requestGateJudgement', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('INGEST_INTERNAL_URL', 'https://ingest.test/')
    vi.stubEnv('INGEST_INTERNAL_TOKEN', 'secret-token')
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    fetchMock.mockReset()
  })

  it('posts the item id with the bearer token and a timeout', async () => {
    fetchMock.mockResolvedValue(Response.json({ ok: true, decision }))
    expect(await requestGateJudgement(ITEM, log)).toEqual({ ok: true, decision })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://ingest.test/internal/gate/judge')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({ authorization: 'Bearer secret-token' })
    expect(JSON.parse(init.body as string)).toEqual({ itemId: ITEM })
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('maps an error body and a non-JSON body to codes', async () => {
    fetchMock.mockResolvedValue(
      Response.json({ ok: false, error: { code: 'no_evidence', message: 'x' } }, { status: 422 }),
    )
    expect(await requestGateJudgement(ITEM, log)).toEqual({ ok: false, code: 'no_evidence' })
    fetchMock.mockResolvedValue(new Response('<html>bad gateway</html>', { status: 502 }))
    expect(await requestGateJudgement(ITEM, log)).toEqual({ ok: false, code: 'judge_failed' })
  })

  it('reports a timeout and a network failure without throwing', async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error('timed out'), { name: 'TimeoutError' }))
    expect(await requestGateJudgement(ITEM, log)).toEqual({ ok: false, code: 'judge_timeout' })
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))
    expect(await requestGateJudgement(ITEM, log)).toEqual({ ok: false, code: 'unreachable' })
  })

  it('uses the INGEST service binding when present', async () => {
    vi.stubEnv('INGEST_INTERNAL_URL', '')
    const binding = { fetch: vi.fn(async () => Response.json({ ok: true, decision })) }
    expect(await requestGateJudgement(ITEM, log, { INGEST: binding })).toEqual({
      ok: true,
      decision,
    })
    const [url, init] = binding.fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://internal/internal/gate/judge')
    expect(init.headers).toMatchObject({ authorization: 'Bearer secret-token' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not call out when the worker is not configured', async () => {
    vi.stubEnv('INGEST_INTERNAL_TOKEN', '')
    expect(await requestGateJudgement(ITEM, log)).toEqual({ ok: false, code: 'not_configured' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('judgeItemNow', () => {
  it('reports the verdict and that nothing changed', async () => {
    const judge = vi.fn(async (): Promise<JudgeOutcome> => ({ ok: true, decision }))
    const result = await judgeItemNow({ itemId: ITEM }, log, judge)
    expect(result).toEqual({
      ok: true,
      message: 'Gate says Source only, 41 against 55. Nothing about the item or its reel changed.',
    })
    expect(judge).toHaveBeenCalledWith(ITEM, expect.anything())
  })

  it('turns an error code into a plain message', async () => {
    const judge = async (): Promise<JudgeOutcome> => ({ ok: false, code: 'quota_exhausted' })
    const result = await judgeItemNow({ itemId: ITEM }, log, judge)
    expect(result.ok).toBe(false)
    expect(result.message).toContain('out of quota')
  })

  it('rejects a bad id without calling the worker', async () => {
    const judge = vi.fn()
    expect((await judgeItemNow({ itemId: 'x' }, log, judge)).ok).toBe(false)
    expect(judge).not.toHaveBeenCalled()
  })
})

describe('findItemByReference', () => {
  async function lookup(ref: Parameters<typeof findItemByReference>[1]) {
    const { db, queries } = scriptedDb(() => [item])
    expect(await findItemByReference(db, ref)).toEqual(item)
    return queries[0]!
  }

  it('looks an id up directly', async () => {
    const q = await lookup({ kind: 'id', id: ITEM })
    expect(q.sql).toContain('"item"."id" = $1')
    expect(q.parameters).toContain(ITEM)
  })

  it('looks a short id up as a primary-key range', async () => {
    const q = await lookup({ kind: 'shortId', shortId: '1a2b3c4d' })
    expect(q.sql).toContain('item.id between')
    expect(q.parameters).toEqual(
      expect.arrayContaining([
        '1a2b3c4d-0000-0000-0000-000000000000',
        '1a2b3c4d-ffff-ffff-ffff-ffffffffffff',
      ]),
    )
  })

  it('matches a source URL against the item and its mentions, as parameters', async () => {
    const urls = ["https://example.com/a'; drop table item; --", 'http://example.com/a']
    const q = await lookup({ kind: 'url', candidates: urls })
    expect(q.sql).toContain('"item"."canonical_url" in')
    expect(q.sql).toContain('"mention"."url" in')
    expect(q.sql).not.toContain('drop table')
    expect(q.parameters).toEqual(expect.arrayContaining(urls))
  })

  it('returns null when nothing matches', async () => {
    const { db } = scriptedDb(() => [])
    expect(await findItemByReference(db, { kind: 'id', id: ITEM })).toBeNull()
  })
})

describe('checkLink', () => {
  type World = { found: boolean; judged: boolean }

  function world(state: World) {
    const judge = vi.fn(async (): Promise<JudgeOutcome> => {
      state.judged = true
      return { ok: true, decision }
    })
    const respond = (q: CompiledQuery): Scripted => {
      if (sqlHas(q, 'from "gate_decision"')) return state.judged ? [judgement] : []
      if (sqlHas(q, 'from "item"')) return state.found ? [item] : []
      return []
    }
    return { ...scriptedDb(respond), judge }
  }

  it('shows the existing judgement without judging again', async () => {
    const { db, judge } = world({ found: true, judged: true })
    const check = await checkLink(db, `https://reelset.app/r/x-1a2b3c4d`, log, judge)
    expect(check).toMatchObject({
      kind: 'card',
      item,
      judgedNow: false,
      gate: { verdict: 'source_only', score: 41, manual: true },
    })
    expect(judge).not.toHaveBeenCalled()
  })

  it('judges an item the gate has never seen, then shows its card', async () => {
    const { db, judge, queries } = world({ found: true, judged: false })
    const check = await checkLink(db, ITEM, log, judge)
    expect(check).toMatchObject({ kind: 'card', judgedNow: true })
    expect(judge).toHaveBeenCalledWith(ITEM, expect.anything())
    expect(queries.every((q) => q.sql.startsWith('select'))).toBe(true)
  })

  it('says so when the source is not in reelset', async () => {
    const { db, judge } = world({ found: false, judged: false })
    expect(await checkLink(db, 'https://example.com/unknown', log, judge)).toEqual({
      kind: 'not_found',
      message: 'This source is not in reelset yet.',
    })
    expect(judge).not.toHaveBeenCalled()
  })

  it('keeps the item on screen when judging fails', async () => {
    const { db } = world({ found: true, judged: false })
    const judge = async (): Promise<JudgeOutcome> => ({ ok: false, code: 'no_evidence' })
    const check = await checkLink(db, ITEM, log, judge)
    expect(check).toMatchObject({ kind: 'failed', item })
    expect(check.kind === 'failed' ? check.message : '').toContain('no stored source text')
  })

  it('rejects junk input before any query, and survives a database error', async () => {
    const { db, queries, judge } = world({ found: true, judged: true })
    for (const bad of ['', 'hello world', null, 42]) {
      expect((await checkLink(db, bad, log, judge)).kind).toBe('invalid')
    }
    expect(queries).toHaveLength(0)
    const broken = scriptedDb(() => new Error('relation "gate_decision" does not exist'))
    expect((await checkLink(broken.db, ITEM, log, judge)).kind).toBe('invalid')
  })
})
