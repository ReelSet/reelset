import { createLogger, type Database, type ReelRequestRow } from '@reelset/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  open: 0,
  today: 0,
  balance: 1000,
  spendOk: true,
}))

vi.mock('@reelset/core', async (orig) => {
  const actual = await orig<typeof import('@reelset/core')>()
  return {
    ...actual,
    getSetting: vi.fn(async (_db: unknown, s: { key: string; default: unknown }) => s.default),
    countOpenReelRequests: vi.fn(async () => m.open),
    countReelRequestsSince: vi.fn(async () => m.today),
    creditBalance: vi.fn(async () => m.balance),
    createChargedReelRequest: vi.fn(
      async (_db: unknown, input: { userId: string; urls: string[]; via: string }) =>
        m.spendOk
          ? {
              ok: true,
              balance: 900,
              request: row({ user_id: input.userId, urls: input.urls, via: input.via }),
            }
          : { ok: false, balance: 50 },
    ),
    createReelRequest: vi.fn(
      async (_db: unknown, input: { userId: string; urls: string[]; via: string }) =>
        row({ user_id: input.userId, urls: input.urls, via: input.via }),
    ),
    setReelRequestResult: vi.fn(async () => true),
    settleReelRequests: vi.fn(async () => ({ done: 0, failed: 0, refunded: 0 })),
  }
})
vi.mock('./queries', () => ({
  loadRequestContexts: vi.fn(async (_db: unknown, rows: ReelRequestRow[]) => {
    return new Map(
      rows.map((r) => [
        r.id,
        {
          item: r.item_id
            ? {
                id: r.item_id,
                title: 'T',
                status: 'rendered',
                visibility: 'private',
                owner_id: r.user_id,
                publish_review: null,
                publish_requested_at: null,
                publish_reviewed_at: null,
                publish_note: null,
              }
            : null,
          render: r.item_id
            ? {
                status: 'done',
                video_key: 'v/1.mp4',
                poster_key: 'v/1.jpg',
                video_duration_ms: 50000,
                finished_at: new Date(),
              }
            : null,
          events: [],
          aheadOfYou: 2,
        },
      ]),
    )
  }),
}))
vi.mock('@/server/env', () => ({ mediaBaseUrl: () => 'https://media.test' }))

const core = await import('@reelset/core')
const { createGenerateRequest, getCredits, getRequestForViewer, maybeSettle, resetSettleThrottle } =
  await import('./service')

const log = createLogger({ app: 'test', level: 'silent' })
const db = {} as Database
const user = { id: 'u1', email: 'u@x.co', isAdmin: false }
const admin = { id: 'a1', email: 'a@x.co', isAdmin: true }
const urls = ['https://github.com/a/b']

function row(over: Partial<ReelRequestRow> = {}): ReelRequestRow {
  return {
    id: 'r1',
    user_id: 'u1',
    urls,
    status: 'pending',
    item_id: null,
    error: null,
    credits_charged: 0,
    refunded: false,
    via: 'web',
    created_at: new Date('2026-11-15T10:00:00Z'),
    updated_at: new Date('2026-11-15T10:00:00Z'),
    ...over,
  } as ReelRequestRow
}

beforeEach(() => {
  m.open = 0
  m.today = 0
  m.balance = 1000
  m.spendOk = true
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}')),
  )
})

describe('createGenerateRequest', () => {
  it('creates a request, charges 100 credits and returns a pending dto', async () => {
    const res = await createGenerateRequest(db, { user, urls, via: 'web' }, log)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(core.createChargedReelRequest).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ userId: 'u1', cost: 100, monthlyFree: 1000, via: 'web' }),
      expect.anything(),
    )
    expect(core.createReelRequest).not.toHaveBeenCalled()
    expect(res.request.steps.map((s) => s.key)).toEqual([
      'queued',
      'reading',
      'script',
      'render',
      'ready',
    ])
    expect(res.request.aheadOfYou).toBe(2)
    expect(res.credits.cost).toBe(100)
  })

  it('rejects invalid urls with 400 before touching the db', async () => {
    const res = await createGenerateRequest(
      db,
      { user, urls: ['http://127.0.0.1'], via: 'web' },
      log,
    )
    expect(res).toMatchObject({ ok: false, status: 400, error: 'invalid_urls' })
    expect(core.createReelRequest).not.toHaveBeenCalled()
  })

  it('enforces 3 open requests and 20 per day for users', async () => {
    m.open = 3
    expect(await createGenerateRequest(db, { user, urls, via: 'web' }, log)).toMatchObject({
      ok: false,
      status: 429,
      error: 'too_many_open',
    })
    m.open = 0
    m.today = 20
    expect(await createGenerateRequest(db, { user, urls, via: 'web' }, log)).toMatchObject({
      ok: false,
      status: 429,
      error: 'daily_limit',
    })
  })

  it('returns out_of_credits (402) when the balance is short, without creating a request', async () => {
    m.balance = 50
    const res = await createGenerateRequest(db, { user, urls, via: 'web' }, log)
    expect(res).toMatchObject({ ok: false, status: 402, error: 'out_of_credits' })
    expect(core.createReelRequest).not.toHaveBeenCalled()
  })

  it('returns 402 when the atomic charge finds the balance short', async () => {
    m.spendOk = false
    const res = await createGenerateRequest(db, { user, urls, via: 'web' }, log)
    expect(res).toMatchObject({ ok: false, status: 402, error: 'out_of_credits' })
    expect(core.setReelRequestResult).not.toHaveBeenCalled()
  })

  it('exempts admins from limits and credits', async () => {
    m.open = 99
    m.today = 99
    m.balance = 0
    const res = await createGenerateRequest(db, { user: admin, urls, via: 'admin' }, log)
    expect(res.ok).toBe(true)
    expect(core.createChargedReelRequest).not.toHaveBeenCalled()
    expect(core.createReelRequest).toHaveBeenCalled()
    if (res.ok) {
      expect(res.credits.unlimited).toBe(true)
      expect(res.credits.balance).toBe(1000)
    }
  })

  it('kicks the ingest worker with a bearer token, best effort', async () => {
    vi.stubEnv('INGEST_INTERNAL_URL', 'https://ingest.test/')
    vi.stubEnv('INGEST_INTERNAL_TOKEN', 'tok')
    await createGenerateRequest(db, { user, urls, via: 'web' }, log)
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://ingest.test/internal/generate/kick')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok')
  })

  it('still succeeds when the kick throws', async () => {
    vi.stubEnv('INGEST_INTERNAL_URL', 'https://ingest.test')
    vi.stubEnv('INGEST_INTERNAL_TOKEN', 'tok')
    vi.mocked(fetch).mockRejectedValue(new Error('timeout'))
    const res = await createGenerateRequest(db, { user, urls, via: 'web' }, log)
    expect(res.ok).toBe(true)
  })
})

describe('getCredits', () => {
  it('computes balance and reels left from the ledger balance', async () => {
    m.balance = 450
    const credits = await getCredits(db, user, log, new Date('2026-11-15T00:00:00Z'))
    expect(credits).toMatchObject({
      balance: 450,
      reelsLeft: 4,
      unlimited: false,
      resetsAt: '2026-12-01T00:00:00.000Z',
    })
  })
})

describe('maybeSettle', () => {
  it('runs at most once per 30 seconds', async () => {
    resetSettleThrottle()
    await maybeSettle(db, log, 100_000)
    await maybeSettle(db, log, 110_000)
    expect(core.settleReelRequests).toHaveBeenCalledTimes(1)
    await maybeSettle(db, log, 131_000)
    expect(core.settleReelRequests).toHaveBeenCalledTimes(2)
  })
})

describe('getRequestForViewer', () => {
  it('returns null for a malformed id without querying', async () => {
    expect(await getRequestForViewer(db, 'not-a-uuid', user)).toBeNull()
    expect(await getRequestForViewer(db, 'x'.repeat(36), user)).toBeNull()
  })
})
