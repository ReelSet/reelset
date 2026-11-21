import { describe, expect, it } from 'vitest'
import { appHref } from './app-url'

describe('appHref', () => {
  it('points at the main domain in production', () => {
    expect(appHref('/create/abc', 'production')).toBe('https://reelset.app/create/abc')
    expect(appHref('/', 'production')).toBe('https://reelset.app/')
  })

  it('keeps relative paths in development', () => {
    expect(appHref('/create/abc', 'development')).toBe('/create/abc')
  })
})
