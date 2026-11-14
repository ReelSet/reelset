import { createLogger, type Database } from '@reelset/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReelRequestDto } from '@/lib/generate/types'

const m = vi.hoisted(() => ({ key: null as null | { id: string; userId: string; name: string } }))

vi.mock('@reelset/core', async (orig) => {
  const actual = await orig<typeof import('@reelset/core')>()
  return { ...actual, findApiKeyByToken: vi.fn(async () => m.key) }
})
vi.mock('./service', () => ({
  resolveViewer: vi.fn(async (_db: unknown, u: { id: string }) => ({
    id: u.id,
    email: null,
    isAdmin: false,
  })),
  createGenerateRequest: vi.fn(),
  getRequestForViewer: vi.fn(),
  listMyRequests: vi.fn(),
  getCredits: vi.fn(),
}))

const service = await import('./service')
const { authenticateMcp, bearerToken } = await import('./mcp-auth')
const tools = await import('./mcp-tools')

const log = createLogger({ app: 'test', level: 'silent' })
const db = {} as Database
const ctx = { db, user: { id: 'u1', email: null, isAdmin: false }, log }

const doneDto: ReelRequestDto = {
  id: '11111111-2222-3333-4444-555555555555',
  urls: ['https://a.com'],
  status: 'done',
  error: null,
  createdAt: '2026-11-15T10:00:00.000Z',
  via: 'mcp',
  creditsCharged: 100,
  steps: [{ key: 'ready', label: 'Ready', state: 'done', at: null }],
  aheadOfYou: null,
  reel: {
    itemId: 'i1',
    title: 'Cool',
    pageUrl: 'https://reelset.app/r/cool-1',
    videoUrl: 'https://media.test/a.mp4',
    downloadUrl: 'https://render-api.reelset.app/dl/a.mp4',
    posterUrl: 'https://media.test/a.jpg',
    durationMs: 50000,
    visibility: 'private',
  },
}
const credits = {
  balance: 900,
  monthlyFree: 1000,
  cost: 100,
  resetsAt: '2026-12-01T00:00:00.000Z',
  unlimited: false,
  reelsLeft: 9,
}

beforeEach(() => {
  vi.clearAllMocks()
  m.key = null
})

describe('mcp auth', () => {
  it('parses bearer tokens', () => {
    expect(bearerToken('Bearer rs_live_abc')).toBe('rs_live_abc')
    expect(bearerToken('bearer   x')).toBe('x')
    expect(bearerToken('Basic abc')).toBeNull()
    expect(bearerToken(null)).toBeNull()
  })

  it('rejects a missing header and an unknown key', async () => {
    expect((await authenticateMcp(db, null, log)).ok).toBe(false)
    expect((await authenticateMcp(db, 'Bearer rs_live_nope', log)).ok).toBe(false)
  })

  it('accepts a valid key and resolves the viewer', async () => {
    m.key = { id: 'k1', userId: 'u9', name: 'laptop' }
    const res = await authenticateMcp(db, 'Bearer rs_live_good', log)
    expect(res).toMatchObject({ ok: true, keyId: 'k1', viewer: { id: 'u9' } })
  })
})

describe('mcp tools', () => {
  it('generate_reel returns request id, status and credits left', async () => {
    vi.mocked(service.createGenerateRequest).mockResolvedValue({
      ok: true,
      request: { ...doneDto, status: 'pending', reel: null },
      credits,
    })
    const res = await tools.generateReelTool(ctx, { urls: ['https://a.com'] })
    expect(service.createGenerateRequest).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ via: 'mcp', urls: ['https://a.com'] }),
      log,
    )
    expect(res.isError).toBeUndefined()
    expect(res.structuredContent).toMatchObject({
      request_id: doneDto.id,
      status: 'pending',
      credits_left: 900,
      video_url: null,
    })
  })

  it('generate_reel surfaces errors as tool errors', async () => {
    vi.mocked(service.createGenerateRequest).mockResolvedValue({
      ok: false,
      status: 402,
      error: 'out_of_credits',
      message: 'out',
    })
    const res = await tools.generateReelTool(ctx, { urls: ['https://a.com'] })
    expect(res.isError).toBe(true)
    expect(res.structuredContent).toEqual({ error: 'out_of_credits' })
  })

  it('get_reel_status returns video, poster and page urls when done', async () => {
    vi.mocked(service.getRequestForViewer).mockResolvedValue(doneDto)
    vi.mocked(service.getCredits).mockResolvedValue(credits)
    const res = await tools.getReelStatusTool(ctx, { request_id: doneDto.id })
    expect(res.structuredContent).toMatchObject({
      status: 'done',
      video_url: 'https://media.test/a.mp4',
      poster_url: 'https://media.test/a.jpg',
      page_url: 'https://reelset.app/r/cool-1',
      credits_left: 900,
    })
    expect(JSON.stringify(res.content)).toContain('https://media.test/a.mp4')
  })

  it('get_reel_status reports not found', async () => {
    vi.mocked(service.getRequestForViewer).mockResolvedValue(null)
    const res = await tools.getReelStatusTool(ctx, { request_id: 'nope' })
    expect(res.isError).toBe(true)
  })

  it('list_my_reels clamps the limit', async () => {
    vi.mocked(service.listMyRequests).mockResolvedValue([doneDto])
    const res = await tools.listMyReelsTool(ctx, { limit: 500 })
    expect(service.listMyRequests).toHaveBeenCalledWith(db, 'u1', 20, log)
    expect(res.structuredContent).toMatchObject({ count: 1 })
  })

  it('get_credits reports unlimited for admins', async () => {
    vi.mocked(service.getCredits).mockResolvedValue({ ...credits, unlimited: true })
    const res = await tools.getCreditsTool(ctx)
    expect(res.structuredContent).toMatchObject({ credits_left: 'unlimited' })
  })
})
