import { describe, expect, it } from 'vitest'
import { buildInsights, engagementRate, type InsightRow } from './insights'

const NOW = new Date('2026-11-20T12:00:00Z')

const row = (id: string, postedAt: string, over: Partial<InsightRow> = {}): InsightRow => ({
  id,
  itemId: `item-${id}`,
  title: `Reel ${id}`,
  source: 'hn',
  permalink: null,
  postedAt: new Date(postedAt),
  views: 100,
  reach: 80,
  likes: 5,
  comments: 1,
  saves: 3,
  shares: 1,
  ...over,
})

const build = (rows: InsightRow[], days = 7) => buildInsights(rows, { now: NOW, tz: 'UTC', days })

describe('engagementRate', () => {
  it('is null without views so an unsynced reel never reads as 0%', () => {
    expect(engagementRate(5, 0)).toBeNull()
    expect(engagementRate(10, 200)).toBe(5)
  })
})

describe('buildInsights', () => {
  it('sums the current window and compares to the previous one', () => {
    const out = build([
      row('a', '2026-11-19T10:00:00Z', { views: 300 }),
      row('b', '2026-11-18T10:00:00Z', { views: 100 }),
      row('c', '2026-11-08T10:00:00Z', { views: 200 }),
    ])
    expect(out.metrics.views.total).toBe(400)
    expect(out.metrics.views.prevTotal).toBe(200)
    expect(out.metrics.views.deltaPct).toBe(100)
    expect(out.metrics.posts.total).toBe(2)
    expect(out.postsInRange).toBe(2)
  })

  it('computes the engagement rate from interactions over views', () => {
    const out = build([
      row('a', '2026-11-19T10:00:00Z', { views: 100, likes: 8, comments: 0, saves: 1, shares: 1 }),
    ])
    expect(out.metrics.engagement.total).toBe(10)
  })

  it('leaves unsynced reels out of averages and rankings', () => {
    const out = build([
      row('a', '2026-11-19T10:00:00Z', { views: 200 }),
      row('b', '2026-11-19T11:00:00Z', { views: null, likes: null }),
    ])
    expect(out.postsInRange).toBe(2)
    expect(out.syncedInRange).toBe(1)
    expect(out.topReels.map((r) => r.id)).toEqual(['a'])
    expect(out.bySource).toEqual([{ source: 'hn', posts: 1, avgViews: 200, rate: 5 }])
  })

  it('ranks top reels by views and buckets the posting hour in the viewer zone', () => {
    const out = buildInsights(
      [
        row('a', '2026-11-19T20:00:00Z', { views: 50 }),
        row('b', '2026-11-19T21:00:00Z', { views: 500 }),
      ],
      { now: NOW, tz: 'Asia/Kolkata', days: 7 },
    )
    expect(out.topReels.map((r) => r.id)).toEqual(['b', 'a'])
    expect(out.byHour[1]).toMatchObject({ hour: 1, posts: 1, avgViews: 50 })
    expect(out.byHour[2]).toMatchObject({ hour: 2, posts: 1, avgViews: 500 })
    expect(out.byHour).toHaveLength(24)
  })

  it('handles no posts', () => {
    const out = build([])
    expect(out.metrics.views.total).toBe(0)
    expect(out.metrics.engagement.deltaPct).toBeNull()
    expect(out.funnel.every((s) => s.value === 0)).toBe(true)
  })
})
