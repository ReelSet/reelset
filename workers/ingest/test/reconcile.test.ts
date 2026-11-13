import { describe, expect, it, vi } from 'vitest'
import {
  admissionDecision,
  chunked,
  classifyStuck,
  interleaveBySource,
  utcDayStart,
} from '../src/reconcile/policy'
import { reconcile } from '../src/reconcile/reconcile'
import { evaluateAlerts, type AlertSnapshot } from '../src/reconcile/alerts'
import { createFakeDb, type RecordedQuery } from './helpers/fake-db'
import { testLog } from './helpers/mock-fetch'

const now = new Date('2026-11-09T12:00:00Z')
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000)

describe('admissionDecision', () => {
  const base = {
    score: 0.6,
    minScore: 0.35,
    admittedToday: 10,
    dailyCap: 200,
    spendTodayUsd: 1,
    spendCapUsd: 10,
  }
  it('admits items that pass every gate', () => {
    expect(admissionDecision(base)).toEqual({ admit: true })
  })
  it('rejects low scores, a full daily cap and a reached spend cap', () => {
    expect(admissionDecision({ ...base, score: 0.34 })).toEqual({
      admit: false,
      reason: 'below_score',
    })
    expect(admissionDecision({ ...base, score: 0.35 })).toEqual({ admit: true })
    expect(admissionDecision({ ...base, admittedToday: 200 })).toEqual({
      admit: false,
      reason: 'daily_cap',
    })
    expect(admissionDecision({ ...base, admittedToday: 199 })).toEqual({ admit: true })
    expect(admissionDecision({ ...base, spendTodayUsd: 10 })).toEqual({
      admit: false,
      reason: 'spend_cap',
    })
  })
})

describe('classifyStuck', () => {
  const item = {
    status: 'found' as const,
    queuedAt: minutesAgo(45),
    statusChangedAt: minutesAgo(60),
    attempts: 0,
  }
  it('leaves fresh or unqueued items alone', () => {
    expect(classifyStuck({ ...item, queuedAt: minutesAgo(10) }, now)).toBe('ok')
    expect(classifyStuck({ ...item, queuedAt: null }, now)).toBe('ok')
  })
  it('does not touch items that made progress recently', () => {
    expect(classifyStuck({ ...item, statusChangedAt: minutesAgo(5) }, now)).toBe('ok')
  })
  it('ignores statuses the reconciler does not own', () => {
    for (const status of ['rendered', 'failed', 'insufficient_source'] as const) {
      expect(classifyStuck({ ...item, status }, now)).toBe('ok')
    }
  })
  it('requeues until the third attempt, then fails', () => {
    expect(classifyStuck({ ...item, attempts: 0 }, now)).toBe('requeue')
    expect(classifyStuck({ ...item, attempts: 1 }, now)).toBe('requeue')
    expect(classifyStuck({ ...item, attempts: 2 }, now)).toBe('fail')
  })
  it('applies to summarized, embedded and voiced items too', () => {
    expect(classifyStuck({ ...item, status: 'voiced' }, now)).toBe('requeue')
    expect(classifyStuck({ ...item, status: 'embedded' }, now)).toBe('requeue')
    expect(classifyStuck({ ...item, status: 'summarized', attempts: 5 }, now)).toBe('fail')
  })
})

describe('helpers', () => {
  it('computes the UTC day start', () => {
    expect(utcDayStart(new Date('2026-11-09T23:59:59Z')).toISOString()).toBe(
      '2026-11-09T00:00:00.000Z',
    )
  })
  it('chunks arrays', () => {
    expect(chunked([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(chunked([], 2)).toEqual([])
  })
})

type Row = Record<string, unknown>
function scriptedDb(rows: {
  found?: Row[]
  summarized?: Row[]
  embedded?: Row[]
  voiced?: Row[]
  stuck?: Row[]
  admitted?: number
  inFlight?: number
  spent?: number
  settings?: Record<string, unknown>
}) {
  return createFakeDb((q: RecordedQuery) => {
    const s = q.sql
    if (s.includes('from "app_setting"')) {
      const key = String(q.params[0])
      return key in (rows.settings ?? {}) ? [{ value: rows.settings![key] }] : []
    }
    if (s.includes('from "spend_ledger"')) return [{ total: String(rows.spent ?? 0) }]
    if (s.includes('count(distinct item_event.item_id)')) return [{ n: String(rows.admitted ?? 0) }]
    if (s.startsWith('select count(*) as "n" from "item"'))
      return [{ n: String(rows.inFlight ?? 0) }]
    if (s.includes('"queued_at" <')) return rows.stuck ?? []
    if (s.startsWith('select "id", "score" from "item"')) return rows.found ?? []
    if (s.startsWith('select "id" from "item"')) {
      if (q.params[0] === 'embedded') return rows.embedded ?? []
      if (q.params[0] === 'voiced') return rows.voiced ?? []
      return rows.summarized ?? []
    }
    if (s.startsWith('update "item" set "queued_at" = now()')) {
      const ids = q.params as string[]
      return ids
        .filter((p) => typeof p === 'string' && p.startsWith('item-'))
        .map((id) => ({ id, attempts: 0 }))
    }
    if (s.startsWith('update "item" set "queued_at" = $1, "attempts"'))
      return { rows: [], affected: 1 }
    if (s.startsWith('update "item" set "status"')) return { rows: [], affected: 1 }
    return undefined
  })
}

function queues() {
  return {
    ingest: { sendBatch: vi.fn(async () => {}) },
    render: { sendBatch: vi.fn(async () => {}) },
  }
}

describe('reconcile', () => {
  it('admits found items by score, stops at the daily cap, and records admission events', async () => {
    const fake = scriptedDb({
      found: [
        { id: 'item-1', score: 0.9 },
        { id: 'item-2', score: 0.5 },
        { id: 'item-3', score: 0.4 },
        { id: 'item-4', score: 0.1 },
      ],
      admitted: 198,
      settings: { daily_reel_cap: 200 },
    })
    const q = queues()
    const result = await reconcile(fake.db, q, testLog, now)

    expect(result.admitted).toBe(2)
    expect(result.skipped).toEqual({ below_score: 1, daily_cap: 1, spend_cap: 0 })
    const claim = fake.find('update "item" set "queued_at" = now()')[0]!
    expect(claim.sql).toContain('"queued_at" is null')
    expect(claim.params).toEqual(expect.arrayContaining(['item-1', 'item-2']))
    expect(claim.params).not.toContain('item-3')

    const events = fake.find('insert into "item_event"')
    expect(events).toHaveLength(2)
    expect(events[0]!.params).toEqual(expect.arrayContaining(['found', 'started']))
    expect(
      events[0]!.params.some((p) => typeof p === 'string' && p.includes('"admitted":true')),
    ).toBe(true)
    expect(q.ingest.sendBatch).toHaveBeenCalledTimes(1)
  })

  it('does not count failed or insufficient items against the daily cap and skips items without mentions', async () => {
    const fake = scriptedDb({ found: [{ id: 'item-1', score: 0.9 }] })
    await reconcile(fake.db, queues(), testLog, now)
    const count = fake.find('count(distinct item_event.item_id)')[0]!
    expect(count.sql).toContain('inner join "item" on "item"."id" = "item_event"."item_id"')
    expect(count.sql).toContain('"item"."status" not in')
    expect(count.params).toEqual(expect.arrayContaining(['failed', 'insufficient_source']))
    const candidates = fake.find('select "id", "score" from "item"')[0]!
    expect(candidates.sql).toContain('exists (select "mention"."id" from "mention"')
  })

  it('admits nothing and flags the cap when pipeline spend is exhausted', async () => {
    const fake = scriptedDb({ found: [{ id: 'item-1', score: 0.9 }], spent: 12 })
    const q = queues()
    const result = await reconcile(fake.db, q, testLog, now)
    expect(result.admitted).toBe(0)
    expect(result.spendCapReached).toBe(true)
    expect(result.skipped.spend_cap).toBe(1)
    expect(q.ingest.sendBatch).not.toHaveBeenCalled()
    expect(fake.find('insert into "item_event"')).toHaveLength(0)
  })

  it('enqueues summarized to ingest-items and embedded to render-jobs without admission checks', async () => {
    const fake = scriptedDb({
      summarized: [{ id: 'item-s' }],
      embedded: [{ id: 'item-e' }],
      spent: 99,
    })
    const q = queues()
    const result = await reconcile(fake.db, q, testLog, now)
    expect(result.enqueuedSummarized).toBe(1)
    expect(result.enqueuedEmbedded).toBe(1)
    expect(q.ingest.sendBatch).toHaveBeenCalledWith([{ body: { itemId: 'item-s', attempt: 0 } }])
    expect(q.render.sendBatch).toHaveBeenCalledWith([{ body: { itemId: 'item-e', attempt: 0 } }])
  })

  it('re-enqueues voiced items with a cleared queue claim to render-jobs', async () => {
    const fake = scriptedDb({ voiced: [{ id: 'item-v' }] })
    const q = queues()
    const result = await reconcile(fake.db, q, testLog, now)
    expect(result.enqueuedVoiced).toBe(1)
    expect(q.render.sendBatch).toHaveBeenCalledWith([{ body: { itemId: 'item-v', attempt: 0 } }])
    expect(q.ingest.sendBatch).not.toHaveBeenCalled()
  })

  it('releases the claim when the queue send fails', async () => {
    const fake = scriptedDb({ embedded: [{ id: 'item-e' }] })
    const q = queues()
    q.render.sendBatch.mockRejectedValue(new Error('queue down'))
    const result = await reconcile(fake.db, q, testLog, now)
    expect(result.enqueuedEmbedded).toBe(0)
    expect(fake.find('update "item" set "queued_at" = $1')).toHaveLength(1)
  })

  it('resets stuck items for requeue and fails them after the third attempt', async () => {
    const stuck = (id: string, attempts: number) => ({
      id,
      status: 'found',
      queued_at: minutesAgo(45),
      status_changed_at: minutesAgo(90),
      attempts,
    })
    const fake = scriptedDb({ stuck: [stuck('item-a', 0), stuck('item-b', 2)] })
    const result = await reconcile(fake.db, queues(), testLog, now)
    expect(result.stuckRequeued).toBe(1)
    expect(result.stuckFailed).toBe(1)
    const reset = fake.find('"attempts" = attempts + 1')
    expect(reset).toHaveLength(1)
    expect(reset[0]!.params).toContain('item-a')
    const failed = fake.find('update "item" set "status"')
    expect(failed).toHaveLength(1)
    expect(failed[0]!.params).toContain('failed')
    expect(failed[0]!.params).toContain('item-b')
  })

  it('leaves items with a queued or rendering render out of stuck handling', async () => {
    const fake = scriptedDb({})
    await reconcile(fake.db, queues(), testLog, now)
    const stuck = fake.find('"queued_at" <')[0]!
    expect(stuck.sql).toContain('not exists (select "render"."id" from "render"')
    expect(stuck.sql).toContain('"render"."item_id" = "item"."id"')
    expect(stuck.params).toEqual(expect.arrayContaining(['queued', 'rendering']))
  })

  it('enqueues only as many render jobs as the in-flight cap leaves free', async () => {
    const fake = scriptedDb({
      embedded: [{ id: 'item-e1' }, { id: 'item-e2' }],
      voiced: [{ id: 'item-v' }],
      inFlight: 4,
      settings: { render_max_in_flight: 6 },
    })
    const q = queues()
    const result = await reconcile(fake.db, q, testLog, now)
    const select = fake.find('select "id" from "item"').find((c) => c.params[0] === 'embedded')!
    expect(select.params).toContain(2)
    expect(result.enqueuedEmbedded).toBe(2)
    expect(result.enqueuedVoiced).toBe(0)
    expect(fake.find('select "id" from "item"').some((c) => c.params[0] === 'voiced')).toBe(false)
  })

  it('holds back every render job when the in-flight cap is full', async () => {
    const fake = scriptedDb({
      embedded: [{ id: 'item-e' }],
      voiced: [{ id: 'item-v' }],
      inFlight: 9,
      settings: { render_max_in_flight: 6 },
    })
    const q = queues()
    const result = await reconcile(fake.db, q, testLog, now)
    expect(result.enqueuedEmbedded).toBe(0)
    expect(result.enqueuedVoiced).toBe(0)
    expect(q.render.sendBatch).not.toHaveBeenCalled()
  })

  it('keeps going when one step throws', async () => {
    const fake = createFakeDb((q) => {
      if (q.sql.includes('"queued_at" <')) throw new Error('db hiccup')
      return undefined
    })
    await expect(reconcile(fake.db, queues(), testLog, now)).resolves.toMatchObject({
      stuckRequeued: 0,
    })
  })
})

describe('evaluateAlerts', () => {
  const base: AlertSnapshot = {
    now,
    lastRenderedAt: minutesAgo(30),
    firstItemAt: minutesAgo(10_000),
    sourceLastOk: { hn: minutesAgo(10), reddit: minutesAgo(30) },
    youtubeTaskStatuses: ['ok', 'failed', 'failed'],
    spendTodayUsd: 1,
    spendCapUsd: 10,
    transcriptResults: Array.from({ length: 20 }, () => true),
  }
  const keys = (s: AlertSnapshot) => evaluateAlerts(s).map((a) => a.key)

  it('is quiet when healthy', () => {
    expect(keys(base)).toEqual([])
  })
  it('fires no_item_rendered_3h from the last render, or from the first item if nothing ever rendered', () => {
    expect(keys({ ...base, lastRenderedAt: minutesAgo(181) })).toEqual(['no_item_rendered_3h'])
    expect(keys({ ...base, lastRenderedAt: minutesAgo(179) })).toEqual([])
    expect(keys({ ...base, lastRenderedAt: null, firstItemAt: minutesAgo(200) })).toEqual([
      'no_item_rendered_3h',
    ])
    expect(keys({ ...base, lastRenderedAt: null, firstItemAt: null })).toEqual([])
  })
  it('fires source_lag per lagging source', () => {
    const alerts = evaluateAlerts({
      ...base,
      sourceLastOk: {
        hn: minutesAgo(121),
        reddit: minutesAgo(5),
        github: minutesAgo(500),
        news: null,
      },
    })
    expect(alerts.map((a) => a.fields?.source)).toEqual(['hn', 'github'])
  })
  it('fires youtube_search_failing only when the last 3 youtube tasks all failed', () => {
    expect(keys({ ...base, youtubeTaskStatuses: ['failed', 'failed', 'failed'] })).toEqual([
      'youtube_search_failing',
    ])
    expect(keys({ ...base, youtubeTaskStatuses: ['failed', 'failed', 'ok'] })).toEqual([])
    expect(keys({ ...base, youtubeTaskStatuses: ['failed', 'empty', 'failed'] })).toEqual([])
    expect(keys({ ...base, youtubeTaskStatuses: ['failed', 'failed'] })).toEqual([])
    expect(keys({ ...base, youtubeTaskStatuses: [] })).toEqual([])
  })
  it('fires spend_cap_reached at the cap', () => {
    expect(keys({ ...base, spendTodayUsd: 10 })).toEqual(['spend_cap_reached'])
  })
  it('fires transcript_success_low below 50% over the last 20 attempts, needing enough samples', () => {
    const mostlyFailing = [
      ...Array.from({ length: 9 }, () => true),
      ...Array.from({ length: 11 }, () => false),
    ]
    expect(keys({ ...base, transcriptResults: mostlyFailing })).toEqual(['transcript_success_low'])
    expect(
      keys({
        ...base,
        transcriptResults: [
          ...Array.from({ length: 10 }, () => true),
          ...Array.from({ length: 10 }, () => false),
        ],
      }),
    ).toEqual([])
    expect(keys({ ...base, transcriptResults: [false, false, false] })).toEqual([])
    const old = [
      ...Array.from({ length: 20 }, () => true),
      ...Array.from({ length: 30 }, () => false),
    ]
    expect(keys({ ...base, transcriptResults: old })).toEqual([])
  })
})

describe('interleaveBySource', () => {
  const c = (id: string, source: string, score: number) => ({ id, source, score })
  const none = new Map<string, number>()

  it('alternates sources instead of draining the highest scores first', () => {
    const out = interleaveBySource(
      [
        c('h1', 'hn', 0.9),
        c('h2', 'hn', 0.8),
        c('h3', 'hn', 0.7),
        c('r1', 'reddit', 0.5),
        c('y1', 'youtube', 0.4),
      ],
      none,
      0.35,
    )
    expect(out.map((x) => x.id)).toEqual(['h1', 'r1', 'y1', 'h2', 'h3'])
  })
  it('favours sources that were admitted less earlier today', () => {
    const out = interleaveBySource(
      [c('h1', 'hn', 0.9), c('h2', 'hn', 0.8), c('r1', 'reddit', 0.5), c('r2', 'reddit', 0.4)],
      new Map([['hn', 5]]),
      0.35,
    )
    expect(out.map((x) => x.id)).toEqual(['r1', 'r2', 'h1', 'h2'])
  })
  it('puts below-threshold items last and never lets them jump the queue', () => {
    const out = interleaveBySource([c('r1', 'reddit', 0.2), c('h1', 'hn', 0.5)], none, 0.35)
    expect(out.map((x) => x.id)).toEqual(['h1', 'r1'])
  })
  it('handles empty input', () => {
    expect(interleaveBySource([], none, 0.35)).toEqual([])
  })
})
