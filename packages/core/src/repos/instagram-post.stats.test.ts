import { describe, expect, it } from 'vitest'
import { permalinkShortcode } from '../domain/instagram-post'
import { fakeDb } from './fake-db'
import {
  listInstagramPerformance,
  listPostsForStats,
  setPostInsights,
  setPostStats,
} from './instagram-post.repo'

describe('permalinkShortcode', () => {
  it('reads the shortcode from post and reel links of either publisher', () => {
    expect(permalinkShortcode('https://www.instagram.com/p/DfyKbvwvcqo/')).toBe('DfyKbvwvcqo')
    expect(permalinkShortcode('https://www.instagram.com/reel/DfzR6tcCO8s/')).toBe('DfzR6tcCO8s')
    expect(permalinkShortcode('https://www.instagram.com/reelset_app/reel/Ab-_9/?x=1')).toBe(
      'Ab-_9',
    )
  })

  it('finds none in a profile link or nothing', () => {
    expect(permalinkShortcode('https://www.instagram.com/reelset_app/reels/')).toBeNull()
    expect(permalinkShortcode(null)).toBeNull()
  })
})

describe('instagram post stats', () => {
  it('lists live posts and marks the ones the official publisher made', async () => {
    const posted = new Date('2026-11-10T00:00:00Z')
    const { db } = fakeDb(() => [
      {
        id: 'a',
        media_pk: '1',
        permalink: 'x',
        container_id: 'c',
        posted_at: posted,
        insights_at: null,
      },
      {
        id: 'b',
        media_pk: '2',
        permalink: 'y',
        container_id: null,
        posted_at: null,
        insights_at: null,
      },
    ])
    expect(await listPostsForStats(db)).toEqual([
      {
        id: 'a',
        media_pk: '1',
        permalink: 'x',
        official: true,
        posted_at: posted,
        insights_at: null,
      },
      {
        id: 'b',
        media_pk: '2',
        permalink: 'y',
        official: false,
        posted_at: null,
        insights_at: null,
      },
    ])
  })

  it('never overwrites a stored count with a missing one', async () => {
    const seen: { sql: string; params: readonly unknown[] }[] = []
    const { db } = fakeDb((sql, params) => {
      seen.push({ sql, params })
      return []
    })
    await setPostStats(db, 'a', { likes: null, comments: 4 })
    expect(seen[0]?.sql).toMatch(/set "comments_count" = \$1, "stats_at" = now\(\)/)
    expect(seen[0]?.sql).not.toMatch(/like_count/)
    await setPostInsights(db, 'a', null)
    expect(seen[1]?.sql).toMatch(/set "insights_at" = now\(\) where/)
    await setPostInsights(db, 'a', { views: 900, reach: null, saves: 2, shares: 1 })
    expect(seen[2]?.sql).toMatch(/"view_count" = \$1, "saves" = \$2, "shares" = \$3/)
    expect(seen[2]?.params.slice(0, 3)).toEqual([900, 2, 1])
  })
})

describe('listInstagramPerformance', () => {
  const row = {
    item_id: 'i1',
    title: 'Some repo',
    source: 'github',
    posted_at: '2026-11-10T00:00:00.000Z',
    like_count: 12,
    comments_count: 1,
    view_count: null,
    shares: null,
    saves: null,
  }

  it('defaults to 60 days back and posts at least 48 hours old, with synced stats only', async () => {
    let sqlText = ''
    let bound: readonly unknown[] = []
    const { db } = fakeDb((sql, params) => {
      sqlText = sql
      bound = params
      return [row]
    })
    expect(await listInstagramPerformance(db)).toEqual([
      {
        itemId: 'i1',
        title: 'Some repo',
        source: 'github',
        postedAt: new Date('2026-11-10T00:00:00Z'),
        likes: 12,
        comments: 1,
        views: null,
        shares: null,
        saves: null,
      },
    ])
    expect(bound).toEqual(['posted', 60, 48])
    expect(sqlText).toMatch(/p\.stats_at is not null/)
    expect(sqlText).toMatch(/order by p\.posted_at desc/)
    expect(sqlText).toMatch(/from mention m where m\.item_id = i\.id/)
  })

  it('takes a custom window', async () => {
    let bound: readonly unknown[] = []
    const { db } = fakeDb((_sql, params) => {
      bound = params
      return []
    })
    expect(await listInstagramPerformance(db, { sinceDays: 14, minAgeHours: 0 })).toEqual([])
    expect(bound).toEqual(['posted', 14, 0])
  })
})
