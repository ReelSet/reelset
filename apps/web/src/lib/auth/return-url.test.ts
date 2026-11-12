import { describe, expect, it } from 'vitest'
import { buildLoginUrl, reelReturnPath, safeReturnPath } from './return-url'

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
    const url = buildLoginUrl(reelReturnPath('0b5d2f3e-6a1c-4e0b-9a55-1c2d3e4f5a6b'))
    expect(url).toBe('/login?next=%2Fr%2F0b5d2f3e')
    const next = new URL(url, 'http://x').searchParams.get('next')
    expect(next).toBe('/r/0b5d2f3e')
  })

  it('falls back to the feed for unsafe targets', () => {
    expect(buildLoginUrl('https://evil.test')).toBe('/login?next=%2F')
  })
})
