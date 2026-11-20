import { describe, expect, it } from 'vitest'
import { userFromClaims } from './auth'

describe('userFromClaims', () => {
  it('maps sub, email and provider metadata', () => {
    expect(
      userFromClaims({
        sub: 'u1',
        email: 'a@b.co',
        user_metadata: { full_name: ' Ada ', avatar_url: 'https://x.test/a.png' },
      }),
    ).toEqual({
      id: 'u1',
      email: 'a@b.co',
      providerName: 'Ada',
      providerAvatar: 'https://x.test/a.png',
    })
  })

  it('treats a missing or empty email as null', () => {
    expect(userFromClaims({ sub: 'u1', email: '' })?.email).toBeNull()
    expect(userFromClaims({ sub: 'u1' })?.email).toBeNull()
  })

  it('rejects claims without a subject', () => {
    expect(userFromClaims(null)).toBeNull()
    expect(userFromClaims({ email: 'a@b.co' })).toBeNull()
    expect(userFromClaims({ sub: 42 })).toBeNull()
  })
})
