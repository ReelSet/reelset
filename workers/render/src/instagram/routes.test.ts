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
  it('only matches POST /admin/ig/{status,connect,disconnect,run}', () => {
    expect(matchIgRoute('POST', '/admin/ig/status')).toBe('status')
    expect(matchIgRoute('POST', '/admin/ig/disconnect')).toBe('disconnect')
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
      enqueueRun: vi.fn(async () => {}),
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

  it('accepts new credentials only as a username and password pair', async () => {
    const c = ctx()
    const half = await handleIgRoute(
      'connect',
      req('/admin/ig/connect', { token: TOKEN, body: { username: 'someone' } }),
      c,
    )
    expect(half.status).toBe(400)
    const full = await handleIgRoute(
      'connect',
      req('/admin/ig/connect', {
        token: TOKEN,
        body: { username: '@someone', password: 'pw', totpSecret: 'abcd efgh ijkl mnop' },
      }),
      c,
    )
    expect(full.status).toBe(200)
    expect(c.withDeps).toHaveBeenCalledOnce()
  })

  it('routes disconnect to the deps', async () => {
    const c = ctx()
    const res = await handleIgRoute('disconnect', req('/admin/ig/disconnect', { token: TOKEN }), c)
    expect(res.status).toBe(200)
    expect(c.withDeps).toHaveBeenCalledOnce()
  })

  it('hands a queue run to the instagram-run queue instead of running it in waitUntil', async () => {
    const c = ctx()
    const res = await handleIgRoute('run', req('/admin/ig/run', { token: TOKEN }), c)
    expect(res.status).toBe(202)
    expect(c.enqueueRun).toHaveBeenCalledWith({ reason: 'poke' })
    expect(c.withDeps).not.toHaveBeenCalled()
  })

  it('reports a failed enqueue as an error so the admin can retry', async () => {
    const c = ctx({
      enqueueRun: vi.fn(async () => {
        throw new Error('queue down')
      }),
    })
    const res = await handleIgRoute('run', req('/admin/ig/run', { token: TOKEN }), c)
    expect(res.status).toBe(500)
  })
})
