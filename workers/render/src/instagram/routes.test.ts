import { describe, expect, it, vi } from 'vitest'
import { silentLog } from '../testing'
import { handleIgRoute, matchIgRoute, type IgRouteContext } from './routes'
import { isAuthorized } from './auth'

const TOKEN = 'x'.repeat(40)

function req(path: string, init: { token?: string; body?: unknown } = {}) {
  return new Request(`https://render-api.reelset.app${path}`, {
    method: 'POST',
    headers: init.token ? { authorization: `Bearer ${init.token}` } : {},
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
}

describe('matchIgRoute', () => {
  it('only matches POST /admin/ig/{status,connect,run}', () => {
    expect(matchIgRoute('POST', '/admin/ig/status')).toBe('status')
    expect(matchIgRoute('POST', '/admin/ig/connect')).toBe('connect')
    expect(matchIgRoute('POST', '/admin/ig/run')).toBe('run')
    expect(matchIgRoute('GET', '/admin/ig/status')).toBe('not_found')
    expect(matchIgRoute('POST', '/admin/ig/other')).toBe('not_found')
    expect(matchIgRoute('POST', '/transcript')).toBe('not_found')
  })
})

describe('isAuthorized', () => {
  it('accepts only the exact bearer token', async () => {
    expect(await isAuthorized(req('/x', { token: TOKEN }), TOKEN)).toBe(true)
    expect(await isAuthorized(req('/x', { token: `${TOKEN}y` }), TOKEN)).toBe(false)
    expect(await isAuthorized(req('/x'), TOKEN)).toBe(false)
  })

  it('refuses everything when the token is unset or short', async () => {
    expect(await isAuthorized(req('/x', { token: 'short' }), 'short')).toBe(false)
    expect(await isAuthorized(req('/x', { token: '' }), undefined)).toBe(false)
  })
})

describe('handleIgRoute', () => {
  function ctx(overrides: Partial<IgRouteContext> = {}): IgRouteContext {
    return {
      token: TOKEN,
      withDeps: vi.fn(async () => ({ state: 'connected' })) as IgRouteContext['withDeps'],
      waitUntil: vi.fn(),
      log: silentLog,
      ...overrides,
    }
  }

  it('answers 404 without touching deps when unauthenticated', async () => {
    const c = ctx()
    const res = await handleIgRoute('status', req('/admin/ig/status'), c)
    expect(res.status).toBe(404)
    expect(c.withDeps).not.toHaveBeenCalled()
  })

  it('returns the account for an authorized status call', async () => {
    const res = await handleIgRoute('status', req('/admin/ig/status', { token: TOKEN }), ctx())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ state: 'connected' })
  })

  it('rejects a malformed 2FA code before any login', async () => {
    const c = ctx()
    const res = await handleIgRoute(
      'connect',
      req('/admin/ig/connect', { token: TOKEN, body: { code: 'abc' } }),
      c,
    )
    expect(res.status).toBe(400)
    expect(c.withDeps).not.toHaveBeenCalled()
  })

  it('accepts a queue run in the background', async () => {
    const c = ctx()
    const res = await handleIgRoute('run', req('/admin/ig/run', { token: TOKEN }), c)
    expect(res.status).toBe(202)
    expect(c.waitUntil).toHaveBeenCalledOnce()
  })
})
