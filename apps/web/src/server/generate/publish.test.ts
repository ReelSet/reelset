import { createLogger, type Database, type ReelRequestRow } from '@reelset/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReelRequestDto } from '@/lib/generate/types'

const m = vi.hoisted(() => ({
  row: null as unknown,
  request: { ok: true } as { ok: true } | { ok: false; reason: string },
  withdraw: { ok: true } as { ok: true } | { ok: false; reason: string },
}))

vi.mock('@reelset/core', async (orig) => {
  const actual = await orig<typeof import('@reelset/core')>()
  return {
    ...actual,
    getReelRequest: vi.fn(async () => m.row),
    getSetting: vi.fn(async () => 'admin@reelset.test'),
    requestPublish: vi.fn(async () => m.request),
    withdrawPublish: vi.fn(async () => m.withdraw),
  }
})
vi.mock('@/server/cache-revalidate', () => ({ expireReels: vi.fn() }))
vi.mock('./service', () => ({
  toRequestDto: vi.fn(async () => dto),
}))

const core = await import('@reelset/core')
const { expireReels } = await import('@/server/cache-revalidate')
const { submitToFeed, withdrawFromFeed } = await import('./publish')

const REQUEST_ID = '11111111-2222-3333-4444-555555555555'
const ITEM_ID = '99999999-2222-3333-4444-555555555555'
const log = createLogger({ app: 'test', level: 'silent' })
const db = {} as Database
const owner = { id: 'u1', email: 'owner@x.dev', isAdmin: false }

const dto = {
  id: REQUEST_ID,
  reel: { title: 'Cool <repo>', pageUrl: 'https://reelset.app/r/cool-1' },
} as ReelRequestDto

function requestRow(overrides: Partial<ReelRequestRow> = {}) {
  return { id: REQUEST_ID, user_id: 'u1', item_id: ITEM_ID, ...overrides }
}

function sentEmail() {
  const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
  return JSON.parse(init.body as string) as {
    to: string[]
    subject: string
    html: string
    text: string
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  m.row = requestRow()
  m.request = { ok: true }
  m.withdraw = { ok: true }
  vi.stubEnv('RESEND_API_KEY', 're_test')
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'em_1' }))))
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('submitToFeed', () => {
  it('submits the owner item and emails the admin with an escaped payload', async () => {
    const res = await submitToFeed(db, { viewer: owner, requestId: REQUEST_ID }, log)
    expect(res).toEqual({ ok: true, request: dto })
    expect(core.requestPublish).toHaveBeenCalledWith(
      db,
      { itemId: ITEM_ID, ownerId: 'u1' },
      expect.anything(),
    )
    const email = sentEmail()
    expect(email.to).toEqual(['admin@reelset.test'])
    expect(email.subject).toBe('Feed submission: Cool <repo>')
    expect(email.html).toContain('Cool &lt;repo&gt;')
    expect(email.html).not.toContain('Cool <repo>')
    expect(email.text).toContain('owner@x.dev')
    expect(email.text).toContain('https://reelset.app/r/cool-1')
    expect(email.text).toContain('/admin/generate#submissions')
  })

  it('treats someone else request as not found and sends nothing', async () => {
    m.row = requestRow({ user_id: 'someone-else' })
    const res = await submitToFeed(db, { viewer: owner, requestId: REQUEST_ID }, log)
    expect(res).toMatchObject({ ok: false, status: 404, error: 'not_found' })
    expect(core.requestPublish).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('does not even let an admin submit another user reel', async () => {
    m.row = requestRow({ user_id: 'someone-else' })
    const admin = { id: 'a1', email: null, isAdmin: true }
    expect(await submitToFeed(db, { viewer: admin, requestId: REQUEST_ID }, log)).toMatchObject({
      status: 404,
    })
  })

  it('rejects malformed ids and requests without an item before touching the db', async () => {
    expect(await submitToFeed(db, { viewer: owner, requestId: 'nope' }, log)).toMatchObject({
      status: 404,
    })
    expect(core.getReelRequest).not.toHaveBeenCalled()
    m.row = requestRow({ item_id: null })
    expect(await submitToFeed(db, { viewer: owner, requestId: REQUEST_ID }, log)).toMatchObject({
      status: 404,
    })
  })

  it('maps repo refusals to 409 and does not email', async () => {
    m.request = { ok: false, reason: 'already_submitted' }
    const res = await submitToFeed(db, { viewer: owner, requestId: REQUEST_ID }, log)
    expect(res).toMatchObject({ ok: false, status: 409, error: 'not_publishable' })
    m.request = { ok: false, reason: 'not_ready' }
    expect(await submitToFeed(db, { viewer: owner, requestId: REQUEST_ID }, log)).toMatchObject({
      status: 409,
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('still succeeds when the email fails', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('down'))
    const res = await submitToFeed(db, { viewer: owner, requestId: REQUEST_ID }, log)
    expect(res.ok).toBe(true)
  })

  it('skips the email when the admin submits their own reel', async () => {
    const admin = { id: 'u1', email: 'a@x.dev', isAdmin: true }
    expect((await submitToFeed(db, { viewer: admin, requestId: REQUEST_ID }, log)).ok).toBe(true)
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('withdrawFromFeed', () => {
  it('withdraws without emailing', async () => {
    const res = await withdrawFromFeed(db, { viewer: owner, requestId: REQUEST_ID }, log)
    expect(res).toEqual({ ok: true, request: dto })
    expect(core.withdrawPublish).toHaveBeenCalledWith(
      db,
      { itemId: ITEM_ID, ownerId: 'u1' },
      expect.anything(),
    )
    expect(fetch).not.toHaveBeenCalled()
    expect(expireReels).toHaveBeenCalledWith([ITEM_ID], expect.anything())
  })

  it('refuses when nothing is submitted', async () => {
    vi.mocked(expireReels).mockClear()
    m.withdraw = { ok: false, reason: 'not_submitted' }
    expect(await withdrawFromFeed(db, { viewer: owner, requestId: REQUEST_ID }, log)).toMatchObject(
      {
        ok: false,
        status: 409,
      },
    )
    expect(expireReels).not.toHaveBeenCalled()
  })
})
