import { describe, expect, it } from 'vitest'
import { followableTopic } from './feed-tabs'

describe('followableTopic', () => {
  it('prefers a picker topic', () => {
    expect(followableTopic(['rust', 'web', 'ai'])).toEqual({ slug: 'web', label: 'Web' })
  })

  it('falls back to the first topic with a usable slug', () => {
    expect(followableTopic(['!!', 'claude code'])).toEqual({
      slug: 'claude-code',
      label: 'Claude Code',
    })
  })

  it('returns null when the reel has no topics', () => {
    expect(followableTopic([])).toBeNull()
  })
})
