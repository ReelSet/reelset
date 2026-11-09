import { describe, expect, it } from 'vitest'
import {
  authCookieOptions,
  expireCookie,
  isAuthCookie,
  serializeCookie,
  sharedCookieDomain,
} from './cookie-options'

describe('sharedCookieDomain', () => {
  it('applies to the apex and subdomains', () => {
    expect(sharedCookieDomain('.reelset.app', 'reelset.app')).toBe('.reelset.app')
    expect(sharedCookieDomain('.reelset.app', 'admin.reelset.app')).toBe('.reelset.app')
    expect(sharedCookieDomain('.reelset.app', 'ADMIN.reelset.app:443')).toBe('.reelset.app')
  })

  it('stays host-only for localhost, previews and lookalikes', () => {
    expect(sharedCookieDomain('.reelset.app', 'localhost:3000')).toBeNull()
    expect(sharedCookieDomain('.reelset.app', 'reelset-git-x.vercel.app')).toBeNull()
    expect(sharedCookieDomain('.reelset.app', 'evilreelset.app')).toBeNull()
    expect(sharedCookieDomain('.reelset.app', null)).toBeNull()
  })

  it('is off when unset or malformed', () => {
    expect(sharedCookieDomain(undefined, 'reelset.app')).toBeNull()
    expect(sharedCookieDomain('', 'reelset.app')).toBeNull()
    expect(sharedCookieDomain('reelset.app', 'reelset.app')).toBeNull()
  })
})

describe('authCookieOptions', () => {
  it('returns secure lax domain options only when the domain applies', () => {
    expect(authCookieOptions('.reelset.app', 'admin.reelset.app')).toEqual({
      domain: '.reelset.app',
      path: '/',
      sameSite: 'lax',
      secure: true,
    })
    expect(authCookieOptions('.reelset.app', 'localhost:3000')).toBeUndefined()
  })
})

describe('cookie serialization', () => {
  it('expires a domain and a host-only cookie separately', () => {
    expect(expireCookie('sb-x-auth-token', '.reelset.app')).toContain('Domain=.reelset.app')
    expect(expireCookie('sb-x-auth-token')).not.toContain('Domain')
    expect(expireCookie('sb-x-auth-token')).toContain('Max-Age=0')
  })

  it('encodes values and flags', () => {
    const c = serializeCookie('a', 'b c', {
      domain: '.reelset.app',
      maxAge: 5,
      httpOnly: true,
      secure: true,
    })
    expect(c).toBe(
      'a=b%20c; Path=/; Domain=.reelset.app; Max-Age=5; SameSite=Lax; Secure; HttpOnly',
    )
  })

  it('detects supabase cookies', () => {
    expect(isAuthCookie('sb-abc-auth-token.0')).toBe(true)
    expect(isAuthCookie('rs_sid')).toBe(false)
  })
})
