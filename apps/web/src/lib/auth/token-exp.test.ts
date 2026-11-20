import { describe, expect, it } from 'vitest'
import { accessTokenExp, sessionCookieValue, shouldRefresh } from './token-exp'

const NAME = 'sb-abcdref-auth-token'
const NOW = Date.UTC(2026, 10, 21, 12, 0, 0)
const nowSec = NOW / 1000

function b64url(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64url')
}

function jwt(exp: number): string {
  return [b64url('{"alg":"ES256"}'), b64url(JSON.stringify({ sub: 'u1', exp })), 'sig'].join('.')
}

function session(exp: number, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ access_token: jwt(exp), refresh_token: 'r', ...extra })
}

describe('shouldRefresh', () => {
  it('skips the refresh for a token valid well beyond the window', () => {
    const value = 'base64-' + b64url(session(nowSec + 3600))
    expect(shouldRefresh([{ name: NAME, value }], NOW)).toBe(false)
  })

  it('refreshes inside the 5 minute window', () => {
    const value = 'base64-' + b64url(session(nowSec + 120))
    expect(shouldRefresh([{ name: NAME, value }], NOW)).toBe(true)
  })

  it('refreshes an expired token', () => {
    const value = 'base64-' + b64url(session(nowSec - 10))
    expect(shouldRefresh([{ name: NAME, value }], NOW)).toBe(true)
  })

  it('reads a plain JSON cookie, URI encoded', () => {
    const value = encodeURIComponent(session(nowSec + 3600))
    expect(shouldRefresh([{ name: NAME, value }], NOW)).toBe(false)
  })

  it('joins chunked cookies in index order', () => {
    const full = 'base64-' + b64url(session(nowSec + 3600, { user: { name: 'Zoë ☕' } }))
    const cut = Math.floor(full.length / 2)
    const cookies = [
      { name: `${NAME}.1`, value: full.slice(cut) },
      { name: 'sb-abcdref-auth-token-code-verifier', value: 'x' },
      { name: `${NAME}.0`, value: full.slice(0, cut) },
    ]
    expect(sessionCookieValue(cookies)).toBe(full)
    expect(shouldRefresh(cookies, NOW)).toBe(false)
  })

  it('refreshes when a chunk is missing', () => {
    const full = 'base64-' + b64url(session(nowSec + 3600))
    expect(shouldRefresh([{ name: `${NAME}.1`, value: full }], NOW)).toBe(true)
  })

  it('falls back to expires_at when the access token is not a JWT', () => {
    const value = JSON.stringify({ access_token: 'opaque', expires_at: nowSec + 3600 })
    expect(accessTokenExp([{ name: NAME, value }])).toBe(nowSec + 3600)
  })

  it.each([
    ['garbage', 'base64-%%%not-base64'],
    ['not JSON', 'hello'],
    ['no expiry', JSON.stringify({ access_token: 'a.b.c' })],
  ])('refreshes a %s cookie', (_label, value) => {
    expect(shouldRefresh([{ name: NAME, value }], NOW)).toBe(true)
  })

  it('refreshes when only the code verifier is present', () => {
    expect(shouldRefresh([{ name: 'sb-abcdref-auth-token-code-verifier', value: 'x' }], NOW)).toBe(
      true,
    )
  })
})
