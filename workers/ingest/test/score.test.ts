import { describe, expect, it } from 'vitest'
import { engagement, itemScore, mentionScore, primarySource, recencyDecay } from '../src/score'

const now = new Date('2026-11-09T12:00:00Z')
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000)
const daysAgo = (d: number) => hoursAgo(d * 24)

describe('recencyDecay', () => {
  it('is 1 for a brand new post and halves every 72h', () => {
    expect(recencyDecay(now, now)).toBeCloseTo(1)
    expect(recencyDecay(hoursAgo(72), now)).toBeCloseTo(0.5)
  })
  it('never drops below the floor', () => {
    expect(recencyDecay(hoursAgo(24 * 365), now)).toBe(0.25)
  })
  it('treats future timestamps as brand new', () => {
    expect(recencyDecay(new Date(now.getTime() + 1e7), now)).toBeCloseTo(1)
  })
})

describe('engagement', () => {
  it('uses velocity for github and youtube', () => {
    const stars = { source: 'github' as const, score: 700, numComments: null }
    expect(engagement({ ...stars, publishedAt: daysAgo(7) }, now)).toBeCloseTo(Math.log1p(100))
    const views = { source: 'youtube' as const, score: 10_000, numComments: null }
    expect(engagement({ ...views, publishedAt: daysAgo(2) }, now)).toBeCloseTo(Math.log1p(5000))
  })
  it('does not blow up on brand new github repos or videos', () => {
    expect(
      engagement({ source: 'github', score: 50, numComments: null, publishedAt: now }, now),
    ).toBe(Math.log1p(50))
    expect(
      engagement({ source: 'youtube', score: 50, numComments: null, publishedAt: now }, now),
    ).toBe(Math.log1p(100))
  })
})

describe('mentionScore', () => {
  it('rises with points and comments', () => {
    const low = mentionScore({ source: 'hn', score: 10, numComments: 2, publishedAt: now }, now)
    const high = mentionScore({ source: 'hn', score: 600, numComments: 300, publishedAt: now }, now)
    expect(high).toBeGreaterThan(low)
    expect(high).toBeLessThanOrEqual(1)
  })
  it('scores a standout item of every source in the same band', () => {
    const top = {
      hn: mentionScore({ source: 'hn', score: 700, numComments: 400, publishedAt: now }, now),
      reddit: mentionScore(
        { source: 'reddit', score: 1500, numComments: 300, publishedAt: now },
        now,
      ),
      github: mentionScore(
        { source: 'github', score: 5000, numComments: null, publishedAt: daysAgo(2) },
        now,
      ),
      youtube: mentionScore(
        { source: 'youtube', score: 200_000, numComments: null, publishedAt: daysAgo(1) },
        now,
      ),
    }
    for (const score of Object.values(top)) expect(score).toBeGreaterThan(0.9)
  })
  it('scores a typical item of every source low', () => {
    const typical = [
      mentionScore({ source: 'hn', score: 40, numComments: 10, publishedAt: now }, now),
      mentionScore({ source: 'reddit', score: 3, numComments: 2, publishedAt: now }, now),
      mentionScore(
        { source: 'github', score: 80, numComments: null, publishedAt: daysAgo(5) },
        now,
      ),
      mentionScore(
        { source: 'youtube', score: 500, numComments: null, publishedAt: daysAgo(3) },
        now,
      ),
    ]
    for (const score of typical) expect(score).toBeLessThan(0.2)
  })
  it('lets a strong reddit thread and youtube video clear the admission threshold', () => {
    expect(
      mentionScore(
        { source: 'reddit', score: 250, numComments: 80, publishedAt: hoursAgo(10) },
        now,
      ),
    ).toBeGreaterThan(0.35)
    expect(
      mentionScore(
        { source: 'youtube', score: 40_000, numComments: null, publishedAt: daysAgo(2) },
        now,
      ),
    ).toBeGreaterThan(0.35)
  })
  it('gives news a flat base that decays', () => {
    expect(
      mentionScore({ source: 'news', score: null, numComments: null, publishedAt: now }, now),
    ).toBeCloseTo(0.65)
    expect(
      mentionScore(
        { source: 'news', score: null, numComments: null, publishedAt: hoursAgo(72) },
        now,
      ),
    ).toBeCloseTo(0.325)
  })
  it('scores a zero-signal post as zero', () => {
    expect(
      mentionScore({ source: 'reddit', score: 0, numComments: 0, publishedAt: now }, now),
    ).toBe(0)
    expect(
      mentionScore({ source: 'reddit', score: null, numComments: null, publishedAt: now }, now),
    ).toBe(0)
  })
  it('decays older discussion posts but not velocity sources', () => {
    const post = { source: 'hn' as const, score: 300, numComments: 100 }
    expect(mentionScore({ ...post, publishedAt: hoursAgo(144) }, now)).toBeLessThan(
      mentionScore({ ...post, publishedAt: now }, now),
    )
  })
})

describe('primarySource', () => {
  it('returns the source of the strongest mention', () => {
    const hn = { source: 'hn' as const, score: 20, numComments: 1, publishedAt: now }
    const reddit = { source: 'reddit' as const, score: 900, numComments: 200, publishedAt: now }
    expect(primarySource([hn, reddit], now)).toBe('reddit')
    expect(primarySource([], now)).toBeNull()
  })
})

describe('itemScore', () => {
  const hn = { source: 'hn' as const, score: 150, numComments: 100, publishedAt: now }
  it('is 0 without mentions', () => {
    expect(itemScore([], now)).toBe(0)
  })
  it('takes the best mention and adds a bonus per extra mention', () => {
    const single = itemScore([hn], now)
    const double = itemScore([hn, { ...hn, source: 'reddit', score: 5, numComments: 1 }], now)
    expect(double).toBeCloseTo(single + 0.05, 3)
  })
  it('caps the bonus and clamps to 1', () => {
    const many = Array.from({ length: 20 }, () => ({ ...hn, score: 100000, numComments: 100000 }))
    expect(itemScore(many, now)).toBe(1)
    const weak = Array.from({ length: 20 }, () => ({ ...hn, score: 0, numComments: 0 }))
    expect(itemScore(weak, now)).toBeCloseTo(0.2)
  })
})
