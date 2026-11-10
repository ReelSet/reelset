import { describe, expect, it } from 'vitest'
import type { IgAccount } from '@reelset/core'
import { accountFlash, describeAccount, proxyLabel } from './account'

const base: IgAccount = {
  username: 'reelset',
  state: 'connected',
  message: null,
  checkedAt: '2026-11-11T00:00:00.000Z',
  loginFailures: 0,
  proxy: { index: 0, country: 'US', switched: false, down: false },
}

describe('describeAccount', () => {
  it('shows connected with the username', () => {
    expect(describeAccount(base, true)).toMatchObject({
      tone: 'ok',
      headline: 'Connected as @reelset',
    })
  })

  it('asks for a 2FA code when needed', () => {
    expect(describeAccount({ ...base, state: 'needs_code' }, true).needsCode).toBe(true)
    expect(describeAccount({ ...base, state: 'needs_login' }, true).needsCode).toBe(true)
  })

  it('surfaces the challenge guidance', () => {
    const view = describeAccount(
      { ...base, state: 'challenge', message: 'approve in the app' },
      true,
    )
    expect(view).toMatchObject({ tone: 'warn', detail: 'approve in the app' })
  })

  it('suggests the Graph API after three failed logins', () => {
    expect(
      describeAccount({ ...base, state: 'needs_login', loginFailures: 2 }, true).suggestGraphApi,
    ).toBe(false)
    expect(
      describeAccount({ ...base, state: 'needs_login', loginFailures: 3 }, true).suggestGraphApi,
    ).toBe(true)
  })

  it('warns when the proxy is down even though the session is fine', () => {
    const view = describeAccount(
      { ...base, proxy: { ...base.proxy!, down: true }, message: 'proxy gone' },
      true,
    )
    expect(view).toMatchObject({ tone: 'warn', detail: 'proxy gone' })
  })

  it('blocks everything when the poster is not configured', () => {
    expect(describeAccount(base, false)).toMatchObject({ canConnect: false, tone: 'danger' })
  })
})

describe('proxyLabel', () => {
  it('shows the exit country and never any host or credentials', () => {
    expect(proxyLabel(base)).toBe('via proxy (exit US)')
    expect(
      proxyLabel({ ...base, proxy: { index: 1, country: null, switched: true, down: false } }),
    ).toBe('via proxy')
    expect(proxyLabel({ ...base, proxy: { ...base.proxy!, down: true } })).toBe(
      'Proxy not responding',
    )
    expect(proxyLabel(null)).toBeNull()
  })
})

describe('accountFlash', () => {
  it('reports success and failure with advice', () => {
    expect(accountFlash(base)).toEqual({ ok: true, message: 'Connected as @reelset' })
    const failed = accountFlash({
      ...base,
      state: 'needs_login',
      loginFailures: 3,
      message: 'bad password',
    })
    expect(failed.ok).toBe(false)
    expect(failed.message).toContain('Graph API')
  })
})
