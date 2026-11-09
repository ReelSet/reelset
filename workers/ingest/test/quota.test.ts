import { describe, expect, it, vi } from 'vitest'
import { HttpError } from '../src/http'
import { handleMessage } from '../src/pipeline/consumer'
import {
  QuotaExhaustedError,
  asQuotaError,
  isQuotaHttpError,
  probePause,
} from '../src/pipeline/quota'
import { reconcile } from '../src/reconcile/reconcile'
import { createFakeDb, type RecordedQuery } from './helpers/fake-db'
import { testLog } from './helpers/mock-fetch'
import { ITEM_ID, makeDeps, makeWorld } from './helpers/process-deps'

const now = new Date('2026-11-09T12:00:00Z')
const pauseRow = (untilMin: number) => [
  {
    value: {
      reason: 'Gemini HTTP 402',
      since: '2026-11-09T11:00:00.000Z',
      until: new Date(now.getTime() + untilMin * 60_000).toISOString(),
    },
  },
]
const isSetting = (q: RecordedQuery) => q.sql.includes('from "app_setting"')
const err402 = () =>
  new HttpError(402, 'https://x/y?key=abc', '{"error":{"status":"RESOURCE_EXHAUSTED"}}')
const message = (attempts: number) => {
  const m = {
    id: 'm1',
    body: { itemId: ITEM_ID, attempt: 0 },
    attempts,
    acked: 0,
    retried: 0,
    ack: () => void m.acked++,
    retry: () => void m.retried++,
  }
  return m
}

describe('quota classification', () => {
  it('treats 402, quota 429 and billing 403 as quota errors only', () => {
    expect(isQuotaHttpError(new HttpError(402, 'u', ''))).toBe(true)
    expect(isQuotaHttpError(new HttpError(429, 'u', 'RESOURCE_EXHAUSTED'))).toBe(true)
    expect(isQuotaHttpError(new HttpError(403, 'u', 'billing disabled'))).toBe(true)
    expect(isQuotaHttpError(new HttpError(429, 'u', 'slow down'))).toBe(false)
    expect(isQuotaHttpError(new HttpError(500, 'u', 'quota'))).toBe(false)
    expect(isQuotaHttpError(new Error('boom'))).toBe(false)
  })
  it('wraps without leaking the url', () => {
    const wrapped = asQuotaError(err402())
    expect(wrapped).toBeInstanceOf(QuotaExhaustedError)
    expect((wrapped as Error).message).not.toContain('abc')
  })
})

describe('consumer circuit breaker', () => {
  it('pauses, releases the item, acks and never fails it on a quota error', async () => {
    const t = makeDeps(makeWorld(), [asQuotaError(err402()) as Error])
    const m = message(1)
    expect(await handleMessage(t.deps, m)).toBe('paused')
    expect(m.acked).toBe(1)
    expect(m.retried).toBe(0)
    const sqls = t.fake.queries.map((q) => q.sql)
    expect(sqls.some((s) => s.startsWith('insert into "app_setting"'))).toBe(true)
    expect(sqls.some((s) => s.startsWith('update "item" set "status"'))).toBe(false)
    expect(t.fake.queries.some((q) => q.sql.startsWith('update "item" set "queued_at" = $1'))).toBe(
      true,
    )
  })

  it('releases items without calling the llm while paused', async () => {
    const t = makeDeps(makeWorld(), [], (q) => (isSetting(q) ? pauseRow(10) : undefined))
    const m = message(1)
    expect(await handleMessage(t.deps, m)).toBe('acked')
    expect(t.generate).not.toHaveBeenCalled()
    expect(t.fake.queries.some((q) => q.sql.startsWith('update "item" set "queued_at" = $1'))).toBe(
      true,
    )
    expect(t.fake.queries.some((q) => q.sql.startsWith('update "item" set "status"'))).toBe(false)
  })
})

describe('probePause', () => {
  it('does nothing when not paused or not yet due', async () => {
    const none = createFakeDb()
    const probe = vi.fn()
    expect(await probePause(none.db, probe, undefined, testLog, now)).toBe('not_paused')
    const waiting = createFakeDb((q) => (isSetting(q) ? pauseRow(5) : undefined))
    expect(await probePause(waiting.db, probe, undefined, testLog, now)).toBe('not_due')
    expect(probe).not.toHaveBeenCalled()
  })
  it('clears the pause when the probe succeeds', async () => {
    const f = createFakeDb((q) => (isSetting(q) ? pauseRow(-1) : undefined))
    expect(await probePause(f.db, async () => 1, undefined, testLog, now)).toBe('resumed')
    const write = f.queries.find((q) => q.sql.startsWith('insert into "app_setting"'))!
    expect(write.params.join(' ')).toContain('null')
  })
  it('extends the pause when the probe hits the quota again', async () => {
    const f = createFakeDb((q) => (isSetting(q) ? pauseRow(-1) : undefined))
    const probe = async () => {
      throw err402()
    }
    expect(await probePause(f.db, probe, undefined, testLog, now)).toBe('still_paused')
    const write = f.queries.find((q) => q.sql.startsWith('insert into "app_setting"'))!
    expect(write.params.join(' ')).toContain('2026-11-09T12:15:00.000Z')
  })
})

describe('reconcile while paused', () => {
  it('skips admission, summarized enqueue and stuck handling', async () => {
    const f = createFakeDb((q) => (isSetting(q) ? pauseRow(10) : undefined))
    const queues = {
      ingest: { sendBatch: vi.fn(async () => {}) },
      render: { sendBatch: vi.fn(async () => {}) },
    }
    const result = await reconcile(f.db, queues, testLog, now, { probe: async () => 1 })
    expect(result.paused).toBe(true)
    expect(result.admitted).toBe(0)
    const sqls = f.queries.map((q) => q.sql).join('\n')
    expect(sqls).not.toContain('"candidate"')
    expect(f.queries.some((q) => q.sql.includes("'found'") || q.params.includes('found'))).toBe(
      false,
    )
    expect(queues.ingest.sendBatch).not.toHaveBeenCalled()
  })
})
