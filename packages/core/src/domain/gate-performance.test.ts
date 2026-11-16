import { describe, expect, it } from 'vitest'
import {
  GATE_PERFORMANCE_MIN_POSTS,
  performanceMetric,
  selectPerformanceExamples,
  type GatePerformancePost,
} from './gate-performance'

function post(index: number, over: Partial<GatePerformancePost> = {}): GatePerformancePost {
  return {
    itemId: `item-${index}`,
    title: `Reel ${index}`,
    source: 'reddit',
    likes: 10,
    comments: 0,
    views: null,
    ...over,
  }
}

/** 20 posts with interactions 100, 50, 30, 20, twelve at 10, then 5, 4, 2, 1: median 10. */
function account(): GatePerformancePost[] {
  const likes = [100, 50, 30, 20, ...Array.from({ length: 12 }, () => 10), 5, 4, 2, 1]
  return likes.map((value, index) => post(index, { likes: value }))
}

describe('performanceMetric', () => {
  it('uses views only when at least 80% of posts have them', () => {
    const posts = Array.from({ length: 10 }, (_, i) => post(i, { views: i < 8 ? 100 : null }))
    expect(performanceMetric(posts)).toBe('views')
    expect(performanceMetric(posts.map((p, i) => (i === 0 ? { ...p, views: null } : p)))).toBe(
      'interactions',
    )
    expect(performanceMetric([])).toBe('interactions')
  })
})

describe('selectPerformanceExamples', () => {
  it('returns the clear winners then the clear losers as multiples of the median', () => {
    expect(selectPerformanceExamples(account(), { limit: 12 })).toEqual([
      { itemId: 'item-0', title: 'Reel 0', source: 'reddit', outcome: 'winner', multiple: 10 },
      { itemId: 'item-1', title: 'Reel 1', source: 'reddit', outcome: 'winner', multiple: 5 },
      { itemId: 'item-2', title: 'Reel 2', source: 'reddit', outcome: 'winner', multiple: 3 },
      { itemId: 'item-3', title: 'Reel 3', source: 'reddit', outcome: 'winner', multiple: 2 },
      { itemId: 'item-19', title: 'Reel 19', source: 'reddit', outcome: 'loser', multiple: 0.1 },
      { itemId: 'item-18', title: 'Reel 18', source: 'reddit', outcome: 'loser', multiple: 0.2 },
      { itemId: 'item-17', title: 'Reel 17', source: 'reddit', outcome: 'loser', multiple: 0.4 },
      { itemId: 'item-16', title: 'Reel 16', source: 'reddit', outcome: 'loser', multiple: 0.5 },
    ])
  })

  it('counts a comment as two likes', () => {
    const posts = account().map((p, i) => (i === 10 ? { ...p, likes: 0, comments: 40 } : p))
    const top = selectPerformanceExamples(posts, { limit: 12 }).find((e) => e.itemId === 'item-10')
    expect(top).toMatchObject({ outcome: 'winner', multiple: 8 })
  })

  it('splits the limit between the two sides and never shows more than six a side', () => {
    const picked = selectPerformanceExamples(account(), { limit: 3 })
    expect(picked.map((e) => e.outcome)).toEqual(['winner', 'winner', 'loser'])
    const big = Array.from({ length: 100 }, (_, i) => post(i, { likes: 1000 - i * 10 }))
    const all = selectPerformanceExamples(big, { limit: 50 })
    expect(all.filter((e) => e.outcome === 'winner').length).toBeLessThanOrEqual(6)
    expect(all.filter((e) => e.outcome === 'loser').length).toBeLessThanOrEqual(6)
  })

  it('shows nothing below the minimum sample, with a zero median, or with a limit of 0', () => {
    const few = account().slice(0, GATE_PERFORMANCE_MIN_POSTS - 1)
    expect(selectPerformanceExamples(few, { limit: 8 })).toEqual([])
    const quiet = Array.from({ length: 20 }, (_, i) => post(i, { likes: i === 0 ? 9 : 0 }))
    expect(selectPerformanceExamples(quiet, { limit: 8 })).toEqual([])
    expect(selectPerformanceExamples(account(), { limit: 0 })).toEqual([])
  })

  it('leaves out posts without numbers, and a flat account has no clear winners or losers', () => {
    const unmeasured = account().map((p) => ({ ...p, likes: null, comments: null }))
    expect(selectPerformanceExamples(unmeasured, { limit: 8 })).toEqual([])
    const flat = Array.from({ length: 20 }, (_, i) => post(i, { likes: 10 + (i % 3) }))
    expect(selectPerformanceExamples(flat, { limit: 8 })).toEqual([])
  })

  it('uses views when most posts have them and ignores posts without views', () => {
    const posts = account().map((p, i) => ({
      ...p,
      likes: 1,
      views: i === 19 ? null : (p.likes ?? 0) * 100,
    }))
    const picked = selectPerformanceExamples(posts, { limit: 12 })
    expect(picked[0]).toMatchObject({ itemId: 'item-0', multiple: 10 })
    expect(picked.some((e) => e.itemId === 'item-19')).toBe(false)
  })

  it('does not repeat excluded items but still counts them in the median', () => {
    const excludeItemIds = new Set(['item-0', 'item-19'])
    const picked = selectPerformanceExamples(account(), { limit: 12, excludeItemIds })
    expect(picked.map((e) => e.itemId)).toEqual([
      'item-1',
      'item-2',
      'item-3',
      'item-18',
      'item-17',
      'item-16',
    ])
    expect(picked[0]!.multiple).toBe(5)
  })
})
