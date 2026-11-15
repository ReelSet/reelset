import { describe, expect, it } from 'vitest'
import { signupInfoFrom } from './signup-info'

describe('signupInfoFrom', () => {
  it('prefers the provider name and reads the auth provider', () => {
    expect(
      signupInfoFrom({
        id: 'u1',
        email: 'ada@x.dev',
        app_metadata: { provider: 'github' },
        user_metadata: { full_name: 'Ada Lovelace' },
      }),
    ).toEqual({ profileId: 'u1', email: 'ada@x.dev', name: 'Ada Lovelace', provider: 'github' })
  })

  it('falls back to the email local part, then to a placeholder', () => {
    expect(signupInfoFrom({ id: 'u1', email: 'ada@x.dev', app_metadata: {} })).toMatchObject({
      name: 'ada',
      provider: null,
    })
    expect(signupInfoFrom({ id: 'u1' })).toMatchObject({ name: 'Unknown', email: null })
  })

  it('ignores a non-string provider', () => {
    expect(signupInfoFrom({ id: 'u1', app_metadata: { provider: 3 } }).provider).toBeNull()
  })
})
