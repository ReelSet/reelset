import { describe, expect, it } from 'vitest'
import { describeOAuthError, describeSignInError, validateEmail } from './email'

describe('validateEmail', () => {
  it('accepts normal addresses', () => {
    expect(validateEmail(' you@example.com ')).toBeNull()
    expect(validateEmail('a.b+tag@sub.example.dev')).toBeNull()
  })

  it('rejects empty and malformed input', () => {
    expect(validateEmail('')).toMatch(/Enter/)
    expect(validateEmail('   ')).toMatch(/Enter/)
    for (const bad of ['nope', 'a@b', 'a b@c.com', '@x.com', 'a@@x.com']) {
      expect(validateEmail(bad)).toMatch(/does not look/)
    }
  })
})

describe('describeSignInError', () => {
  it('maps rate limits', () => {
    expect(describeSignInError({ status: 429, message: 'x' })).toMatch(/Too many/)
    expect(
      describeSignInError({
        code: 'over_email_send_rate_limit',
        message: 'email rate limit exceeded',
      }),
    ).toMatch(/Too many/)
  })

  it('maps network failures and falls back to a generic message', () => {
    expect(describeSignInError({ message: 'Failed to fetch' })).toMatch(/connection/)
    expect(describeSignInError({ message: 'weird internal detail' })).toMatch(/could not send/i)
  })
})

describe('describeOAuthError', () => {
  it('explains a disabled provider, network failures and the generic case', () => {
    expect(
      describeOAuthError({ message: 'Unsupported provider: provider is not enabled' }),
    ).toMatch(/not available/)
    expect(describeOAuthError({ message: 'Failed to fetch' })).toMatch(/connection/)
    expect(describeOAuthError({ message: 'boom' })).toMatch(/could not start/i)
  })
})
