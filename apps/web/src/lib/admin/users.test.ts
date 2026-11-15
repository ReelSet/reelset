import { describe, expect, it } from 'vitest'
import {
  creditsUsedFrom,
  ilikePattern,
  parseUserId,
  parseUserSearch,
  providerLabel,
  userAvatarUrl,
  userDisplay,
} from './users'

describe('parseUserSearch', () => {
  it('trims, caps length and treats blank as no search', () => {
    expect(parseUserSearch('  ann  ')).toBe('ann')
    expect(parseUserSearch('   ')).toBeNull()
    expect(parseUserSearch(undefined)).toBeNull()
    expect(parseUserSearch('x'.repeat(200))).toHaveLength(80)
    expect(parseUserSearch(['a', 'b'])).toBe('a')
  })
})

describe('ilikePattern', () => {
  it('escapes LIKE wildcards and the escape character', () => {
    expect(ilikePattern('a_b%c\\d')).toBe('%a\\_b\\%c\\\\d%')
  })
})

describe('parseUserId', () => {
  it('accepts uuids only', () => {
    expect(parseUserId('0b1c2d3e-0000-4000-8000-000000000001')).not.toBeNull()
    expect(parseUserId("1' or 1=1")).toBeNull()
    expect(parseUserId(undefined)).toBeNull()
  })
})

describe('providerLabel', () => {
  it('maps known providers and passes unknown ones through', () => {
    expect(providerLabel('google')).toBe('Google')
    expect(providerLabel('discord')).toBe('discord')
    expect(providerLabel(null)).toBe('-')
  })
})

describe('userDisplay', () => {
  it('prefers display name, then provider name, then the email local part', () => {
    const base = { displayName: null, providerName: null, handle: null, email: 'ann@x.io' }
    expect(userDisplay({ ...base, displayName: 'Ann' }).name).toBe('Ann')
    expect(userDisplay({ ...base, providerName: 'Ann P' }).name).toBe('Ann P')
    expect(userDisplay(base)).toEqual({ name: 'ann', handle: null, initial: 'A' })
    expect(userDisplay({ ...base, email: null }).initial).toBe('U')
    expect(userDisplay({ ...base, handle: 'annp' }).handle).toBe('@annp')
  })
})

describe('userAvatarUrl', () => {
  const user = {
    id: 'u1',
    avatar_updated_at: null,
    avatar_hidden: false,
    provider_avatar: 'https://cdn.x/a.png',
  }
  it('uses the custom avatar, then the provider one, honouring hidden and non-https', () => {
    expect(userAvatarUrl({ ...user, avatar_updated_at: new Date(5000) })).toBe(
      '/api/avatar/u1?v=5000',
    )
    expect(userAvatarUrl(user)).toBe('https://cdn.x/a.png')
    expect(userAvatarUrl({ ...user, avatar_hidden: true })).toBeNull()
    expect(userAvatarUrl({ ...user, provider_avatar: 'javascript:alert(1)' })).toBeNull()
  })
})

describe('creditsUsedFrom', () => {
  it('turns a negative month delta into credits used, never below zero', () => {
    expect(creditsUsedFrom(-3)).toBe(3)
    expect(creditsUsedFrom(0)).toBe(0)
    expect(creditsUsedFrom(2)).toBe(0)
  })
})
