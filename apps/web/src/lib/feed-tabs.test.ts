import { describe, expect, it } from 'vitest'
import { followableTopic, pickFeedTabs, withFollowed } from './feed-tabs'

const groups = [
  { slug: 'ai', label: 'AI' },
  { slug: 'rust', label: 'Rust' },
  { slug: 'web', label: 'Web' },
  { slug: 'security', label: 'Security' },
]

describe('pickFeedTabs', () => {
  it('uses popular topics when nothing is followed', () => {
    expect(pickFeedTabs({ followed: [], groups }).map((t) => t.slug)).toEqual(['ai', 'rust', 'web'])
  })

  it('puts followed topics first and fills with popular ones', () => {
    const tabs = pickFeedTabs({ followed: ['security'], groups })
    expect(tabs.map((t) => t.slug)).toEqual(['security', 'ai', 'rust'])
  })

  it('skips followed topics that have no reels and never repeats a tab', () => {
    const tabs = pickFeedTabs({ followed: ['hardware', 'web', 'web'], groups })
    expect(tabs.map((t) => t.slug)).toEqual(['web', 'ai', 'rust'])
  })

  it('honours max', () => {
    expect(pickFeedTabs({ followed: [], groups, max: 1 })).toEqual([{ slug: 'ai', label: 'AI' }])
  })
})

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

describe('withFollowed', () => {
  it('appends a new topic', () => {
    expect(withFollowed(['ai'], 'web')).toEqual(['ai', 'web'])
  })

  it('refuses duplicates and a full list', () => {
    expect(withFollowed(['ai'], 'ai')).toBeNull()
    expect(withFollowed(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], 'web')).toBeNull()
  })
})
