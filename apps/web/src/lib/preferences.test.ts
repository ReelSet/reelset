import { describe, expect, it } from 'vitest'
import { PROFILE_SOURCES, enabledSources, sourcesSchema, storedSources } from './preferences'

describe('sourcesSchema', () => {
  it('never allows every source to be off', () => {
    expect(sourcesSchema.safeParse({ sources: [] }).success).toBe(false)
    expect(sourcesSchema.safeParse({ sources: ['hn'] }).success).toBe(true)
  })

  it('rejects unknown sources', () => {
    expect(sourcesSchema.safeParse({ sources: ['tiktok'] }).success).toBe(false)
  })
})

describe('stored sources', () => {
  it('stores all-on as empty so new sources reach existing users', () => {
    expect(storedSources([...PROFILE_SOURCES])).toEqual([])
    expect(storedSources(['hn', 'github'])).toEqual(['hn', 'github'])
    expect(storedSources(['hn', 'hn', 'bogus'])).toEqual(['hn'])
  })

  it('reads empty as every source', () => {
    expect(enabledSources([])).toEqual([...PROFILE_SOURCES])
    expect(enabledSources(['papers', 'hn'])).toEqual(['hn', 'papers'])
  })
})
