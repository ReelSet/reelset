import { beforeEach, describe, expect, it, vi } from 'vitest'

const requireAdmin = vi.fn()
const redirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`)
})
const notFound = vi.fn(() => {
  throw new Error('NOT_FOUND')
})

vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-return-path': '/items?status=failed' }),
}))
vi.mock('next/navigation', () => ({ redirect, notFound }))
vi.mock('@/server/logger', () => ({ log: { warn: vi.fn() } }))
vi.mock('@/server/auth', () => {
  class UnauthorizedError extends Error {
    constructor(readonly loginUrl: string) {
      super('unauthorized')
    }
  }
  class ForbiddenError extends Error {}
  return { UnauthorizedError, ForbiddenError, requireAdmin }
})

const { assertAdmin } = await import('./guard')
const { UnauthorizedError, ForbiddenError } = await import('@/server/auth')

describe('assertAdmin', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sends anonymous visitors to login instead of a 404', async () => {
    requireAdmin.mockRejectedValue(new UnauthorizedError('/login?next=%2Fadmin'))
    await expect(assertAdmin()).rejects.toThrow('REDIRECT:/login?next=%2Fadmin')
    expect(notFound).not.toHaveBeenCalled()
  })

  it('returns the visitor to the page they asked for after login', async () => {
    requireAdmin.mockResolvedValue({ id: 'a', email: null })
    await assertAdmin()
    expect(requireAdmin).toHaveBeenCalledWith('/items?status=failed')
  })

  it('hides the panel from signed-in non-admins', async () => {
    requireAdmin.mockRejectedValue(new ForbiddenError())
    await expect(assertAdmin()).rejects.toThrow('NOT_FOUND')
  })

  it('returns the admin user', async () => {
    requireAdmin.mockResolvedValue({ id: 'u1' })
    await expect(assertAdmin()).resolves.toEqual({ id: 'u1' })
  })
})
