import { beforeEach, describe, expect, it, vi } from 'vitest'

const requireAdmin = vi.fn()
vi.mock('@/server/logger', () => ({
  routeLog: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }),
}))
vi.mock('@/server/auth', () => {
  class UnauthorizedError extends Error {
    constructor(readonly loginUrl: string) {
      super('unauthorized')
    }
  }
  class ForbiddenError extends Error {}
  return {
    UnauthorizedError,
    ForbiddenError,
    requireAdmin,
    authErrorResponse: (err: unknown) => {
      if (err instanceof UnauthorizedError) {
        return Response.json({ error: 'unauthorized', loginUrl: err.loginUrl }, { status: 401 })
      }
      if (err instanceof ForbiddenError)
        return Response.json({ error: 'forbidden' }, { status: 403 })
      return null
    },
  }
})

const { adminDetailRoute } = await import('./detail-route')
const { UnauthorizedError, ForbiddenError } = await import('@/server/auth')

const ID = '3f2c1f0e-7a7e-4d57-9a54-0d3f3a2b9c11'
const call = (get: ReturnType<typeof adminDetailRoute>, id: string) =>
  get(new Request('http://localhost/api/admin/items/x'), { params: Promise.resolve({ id }) })

describe('adminDetailRoute', () => {
  const load = vi.fn()
  const GET = adminDetailRoute('items', load)

  beforeEach(() => {
    vi.clearAllMocks()
    requireAdmin.mockResolvedValue({ id: 'admin' })
  })

  it('returns 401 for anonymous callers without touching the loader', async () => {
    requireAdmin.mockRejectedValue(new UnauthorizedError('/login?next=%2Fadmin'))
    const res = await call(GET, ID)
    expect(res.status).toBe(401)
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(await res.json()).toMatchObject({ error: 'unauthorized' })
    expect(load).not.toHaveBeenCalled()
  })

  it('returns 403 for signed-in non-admins', async () => {
    requireAdmin.mockRejectedValue(new ForbiddenError())
    const res = await call(GET, ID)
    expect(res.status).toBe(403)
    expect(load).not.toHaveBeenCalled()
  })

  it('returns 500 when the auth check itself breaks', async () => {
    requireAdmin.mockRejectedValue(new Error('db down'))
    expect((await call(GET, ID)).status).toBe(500)
  })

  it('rejects ids that are not guids before querying', async () => {
    const res = await call(GET, '1; drop table item')
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_id' })
    expect(load).not.toHaveBeenCalled()
  })

  it('returns 404 when nothing matches', async () => {
    load.mockResolvedValue(null)
    const res = await call(GET, ID)
    expect(res.status).toBe(404)
    expect(res.headers.get('cache-control')).toBe('private, no-store')
  })

  it('returns the loaded detail, uncached', async () => {
    load.mockResolvedValue({ item: { id: ID } })
    const res = await call(GET, ID)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(await res.json()).toEqual({ item: { id: ID } })
    expect(load).toHaveBeenCalledWith(ID)
  })

  it('hides loader failures behind a generic 500', async () => {
    load.mockRejectedValue(new Error('connection string postgres://secret'))
    const res = await call(GET, ID)
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('secret')
  })
})
