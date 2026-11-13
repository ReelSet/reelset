import { describe, expect, it } from 'vitest'
import {
  profileDetailsSchema,
  providerProfile,
  resolveIdentity,
  sniffImageType,
} from './profile-edit'

const base = {
  profileId: '11111111-1111-4111-8111-111111111111',
  email: 'ada@example.com',
  providerName: null,
  providerAvatar: null,
  displayName: null,
  bio: null,
  avatarHidden: false,
  avatarUpdatedAt: null,
}

describe('profileDetailsSchema', () => {
  it('trims the name and turns a blank bio into null', () => {
    expect(profileDetailsSchema.parse({ name: '  Ada  ', bio: '   ' })).toEqual({
      name: 'Ada',
      bio: null,
    })
  })

  it('rejects empty and over-long names and bios', () => {
    expect(profileDetailsSchema.safeParse({ name: '   ' }).success).toBe(false)
    expect(profileDetailsSchema.safeParse({ name: 'x'.repeat(41) }).success).toBe(false)
    expect(profileDetailsSchema.safeParse({ name: 'ok', bio: 'x'.repeat(161) }).success).toBe(false)
    expect(profileDetailsSchema.safeParse({ name: 'x'.repeat(40) }).success).toBe(true)
  })
})

describe('providerProfile', () => {
  it('reads name and avatar from OAuth metadata and drops non-https avatars', () => {
    expect(
      providerProfile({ full_name: 'Ada L', avatar_url: 'https://lh3.googleusercontent.com/a' }),
    ).toEqual({ name: 'Ada L', avatar: 'https://lh3.googleusercontent.com/a' })
    expect(providerProfile({ picture: 'http://x.test/a.png' }).avatar).toBeNull()
    expect(
      providerProfile({ name: 'Grace H', picture: 'https://lh3.googleusercontent.com/p' }),
    ).toEqual({ name: 'Grace H', avatar: 'https://lh3.googleusercontent.com/p' })
    expect(providerProfile({ avatar_url: 'javascript:alert(1)' }).avatar).toBeNull()
    expect(providerProfile(undefined)).toEqual({ name: null, avatar: null })
  })
})

describe('resolveIdentity', () => {
  it('falls back from saved name to provider name to the email local part', () => {
    expect(resolveIdentity({ ...base, displayName: 'Grace', providerName: 'Ada' }).name).toBe(
      'Grace',
    )
    expect(resolveIdentity({ ...base, providerName: 'Ada' }).name).toBe('Ada')
    expect(resolveIdentity(base).name).toBe('ada')
  })

  it('prefers the uploaded avatar, then the provider avatar unless removed', () => {
    const provider = { ...base, providerAvatar: 'https://x.test/p.png' }
    expect(resolveIdentity(provider).avatarUrl).toBe('https://x.test/p.png')
    expect(resolveIdentity({ ...provider, avatarHidden: true }).avatarUrl).toBeNull()
    const custom = resolveIdentity({ ...provider, avatarUpdatedAt: new Date(5000) })
    expect(custom.avatarUrl).toBe(`/api/avatar/${base.profileId}?v=5000`)
    expect(custom.hasCustomAvatar).toBe(true)
  })
})

describe('sniffImageType', () => {
  it('identifies jpeg, png and webp by magic bytes', () => {
    expect(sniffImageType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg')
    expect(
      sniffImageType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])),
    ).toBe('image/png')
    const webp = new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 ')
    expect(sniffImageType(webp)).toBe('image/webp')
  })

  it('rejects svg, gif, html and empty input', () => {
    const enc = (s: string) => new TextEncoder().encode(s)
    expect(sniffImageType(enc('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull()
    expect(sniffImageType(enc('GIF89a....'))).toBeNull()
    expect(sniffImageType(enc('<html>'))).toBeNull()
    expect(sniffImageType(new Uint8Array(0))).toBeNull()
  })
})
