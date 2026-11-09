import { describe, expect, it } from 'vitest'
import { buildLoginUrl, reelPath, safeReturnPath } from './return-url'

describe('safeReturnPath', () => {
  it('allows same-site paths and rejects open redirects', () => {
    expect(safeReturnPath('/ask')).toBe('/ask')
    expect(safeReturnPath('/?reel=abc')).toBe('/?reel=abc')
    expect(safeReturnPath('https://evil.test')).toBe('/')
    expect(safeReturnPath('//evil.test')).toBe('/')
    expect(safeReturnPath('/\\evil.test')).toBe('/')
    expect(safeReturnPath('/a\nb')).toBe('/')
    expect(safeReturnPath(null)).toBe('/')
    expect(safeReturnPath(undefined, '/ask')).toBe('/ask')
  })
})

describe('buildLoginUrl', () => {
  it('encodes the return path so the same reel opens after login', () => {
    const url = buildLoginUrl(reelPath('0b5d2f3e-6a1c-4e0b-9a55-1c2d3e4f5a6b'))
    expect(url).toBe('/login?next=%2F%3Freel%3D0b5d2f3e-6a1c-4e0b-9a55-1c2d3e4f5a6b')
    const next = new URL(url, 'http://x').searchParams.get('next')
    expect(next).toBe('/?reel=0b5d2f3e-6a1c-4e0b-9a55-1c2d3e4f5a6b')
  })

  it('falls back to the feed for unsafe targets', () => {
    expect(buildLoginUrl('https://evil.test')).toBe('/login?next=%2F')
  })
})
