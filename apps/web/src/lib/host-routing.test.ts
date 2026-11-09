import { describe, expect, it } from 'vitest'
import { routeForHost } from './host-routing'

const adminHost = 'admin.reelset.app'
const route = (host: string | null, pathname: string) => routeForHost({ host, pathname, adminHost })

describe('routeForHost', () => {
  it('serves the admin dashboard at the admin host root', () => {
    expect(route('admin.reelset.app', '/')).toEqual({ kind: 'rewrite', pathname: '/admin' })
    expect(route('admin.reelset.app', '/renders')).toEqual({
      kind: 'rewrite',
      pathname: '/admin/renders',
    })
  })

  it('strips the /admin prefix from URLs on the admin host', () => {
    expect(route('admin.reelset.app', '/admin')).toEqual({ kind: 'redirect', pathname: '/' })
    expect(route('admin.reelset.app', '/admin/spend')).toEqual({
      kind: 'redirect',
      pathname: '/spend',
    })
  })

  it('leaves login, auth callbacks and API routes alone on the admin host', () => {
    for (const path of ['/login', '/auth/callback', '/api/ask']) {
      expect(route('admin.reelset.app', path)).toEqual({ kind: 'next' })
    }
  })

  it('matches the admin host case-insensitively and ignores the port', () => {
    expect(route('ADMIN.reelset.app:443', '/')).toEqual({ kind: 'rewrite', pathname: '/admin' })
  })

  it('hides /admin on the main domain', () => {
    expect(route('reelset.app', '/admin')).toEqual({ kind: 'not_found' })
    expect(route('reelset.app', '/admin/settings')).toEqual({ kind: 'not_found' })
    expect(route('www.reelset.app', '/admin')).toEqual({ kind: 'not_found' })
    expect(route(null, '/admin')).toEqual({ kind: 'not_found' })
  })

  it('does not treat lookalike paths as admin', () => {
    expect(route('reelset.app', '/administrator')).toEqual({ kind: 'next' })
    expect(route('reelset.app', '/')).toEqual({ kind: 'next' })
  })

  it('keeps /admin reachable on localhost for development', () => {
    expect(route('localhost:3000', '/admin')).toEqual({ kind: 'next' })
    expect(route('127.0.0.1:3000', '/admin/renders')).toEqual({ kind: 'next' })
  })
})
