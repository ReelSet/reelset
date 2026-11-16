import { describe, expect, it } from 'vitest'
import { statsParts } from './stats'

describe('statsParts', () => {
  it('lists views, likes and comments in that order with compact numbers', () => {
    expect(statsParts({ view_count: 15_300, like_count: 1, comments_count: 0 })).toEqual([
      '15.3K views',
      '1 like',
      '0 comments',
    ])
  })

  it('leaves out what Instagram has not reported', () => {
    expect(statsParts({ view_count: null, like_count: 42, comments_count: 3 })).toEqual([
      '42 likes',
      '3 comments',
    ])
    expect(statsParts({ view_count: null, like_count: null, comments_count: null })).toEqual([])
  })

  it('adds shares and saves only when there are some', () => {
    expect(
      statsParts({ view_count: 38, like_count: 0, comments_count: 0, shares: 2, saves: 1 }),
    ).toEqual(['38 views', '0 likes', '0 comments', '2 shares', '1 save'])
    expect(
      statsParts({ view_count: 38, like_count: 0, comments_count: 0, shares: 0, saves: null }),
    ).toEqual(['38 views', '0 likes', '0 comments'])
  })
})
