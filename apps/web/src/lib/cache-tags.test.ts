import { describe, expect, it } from 'vitest'
import { reelTag } from './cache-tags'

describe('reelTag', () => {
  it('gives a uuid and its short id the same tag', () => {
    const id = '1a2b3c4d-0000-4000-8000-000000000000'
    expect(reelTag(id)).toBe('reel:1a2b3c4d')
    expect(reelTag('1a2b3c4d')).toBe(reelTag(id))
  })
})
