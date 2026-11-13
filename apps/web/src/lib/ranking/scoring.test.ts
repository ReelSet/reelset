import { describe, expect, it } from 'vitest'
import {
  coldStartScore,
  freshness,
  interleave,
  isPersonalized,
  mainScore,
  personalizedScore,
  rankCandidates,
  stalePenalty,
  topicOverlap,
  type Candidate,
  type RankContext,
} from './scoring'

const asOf = new Date('2026-11-09T12:00:00Z')
const hoursAgo = (h: number) => new Date(asOf.getTime() - h * 3_600_000)

const cand = (id: string, over: Partial<Candidate> = {}): Candidate => ({
  id,
  score: 0.5,
  publishedAt: hoursAgo(1),
  topics: [],
  similarity: null,
  ...over,
})

const cold: RankContext = { asOf, signalCount: 0, profileTopics: [] }
const warm: RankContext = { asOf, signalCount: 10, profileTopics: [] }

describe('freshness', () => {
  it('is 1 now, 0.5 at the half-life, and never above 1 for future dates', () => {
    expect(freshness(asOf, asOf)).toBe(1)
    expect(freshness(hoursAgo(48), asOf)).toBeCloseTo(0.5)
    expect(freshness(hoursAgo(96), asOf)).toBeCloseTo(0.25)
    expect(freshness(hoursAgo(-5), asOf)).toBe(1)
  })
})

describe('personalizedScore', () => {
  it('blends 0.6 similarity, 0.25 freshness, 0.15 item score', () => {
    expect(personalizedScore(1, 1, 1)).toBeCloseTo(1)
    expect(personalizedScore(0.5, 0.4, 0.2)).toBeCloseTo(0.6 * 0.5 + 0.25 * 0.4 + 0.15 * 0.2)
  })

  it('treats missing or negative similarity as zero', () => {
    expect(personalizedScore(null, 0, 0)).toBe(0)
    expect(personalizedScore(-0.4, 0, 0)).toBe(0)
  })
})

describe('mode switch', () => {
  it('personalizes only at 10 or more signals', () => {
    expect(isPersonalized(9)).toBe(false)
    expect(isPersonalized(10)).toBe(true)
  })

  it('uses similarity at 10 signals and ignores it below', () => {
    const similar = cand('a', { similarity: 0.95, score: 0.1 })
    const popular = cand('b', { similarity: 0.1, score: 0.9 })
    expect(mainScore(similar, warm)).toBeGreaterThan(mainScore(popular, warm))
    expect(mainScore(similar, { ...warm, signalCount: 9 })).toBeLessThan(
      mainScore(popular, { ...warm, signalCount: 9 }),
    )
  })
})

describe('cold start', () => {
  it('boosts items matching profile topics', () => {
    const ctx = { ...cold, profileTopics: ['ai'] }
    const match = cand('a', { topics: ['ai'], score: 0.3 })
    const other = cand('b', { topics: ['web'], score: 0.5 })
    expect(coldStartScore(match, ctx)).toBeGreaterThan(coldStartScore(other, ctx))
  })

  it('orders by popularity and freshness with deterministic id tie-break', () => {
    const ids = rankCandidates(
      [cand('b'), cand('a'), cand('c', { score: 0.9 }), cand('d', { publishedAt: hoursAgo(200) })],
      cold,
    )
    expect(ids).toEqual(['c', 'a', 'b', 'd'])
  })
})

describe('interleave', () => {
  const main = Array.from({ length: 10 }, (_, i) => `m${i}`)
  const exploration = ['e0', 'e1', 'e2']

  it('puts an exploration item in every 5th position', () => {
    const out = interleave(main, exploration)
    expect(out[4]).toBe('e0')
    expect(out[9]).toBe('e1')
    expect(out.slice(0, 4)).toEqual(['m0', 'm1', 'm2', 'm3'])
  })

  it('never repeats an id', () => {
    const out = interleave(['a', 'b', 'c', 'd', 'e', 'f'], ['c', 'a', 'z'])
    expect(new Set(out).size).toBe(out.length)
    expect(out).toHaveLength(7)
    expect(out[4]).toBe('z')
  })

  it('falls back to main when exploration runs out and vice versa', () => {
    expect(interleave(main.slice(0, 6), [])).toEqual(main.slice(0, 6))
    expect(interleave([], ['x', 'y'])).toEqual(['x', 'y'])
  })

  it('is deterministic', () => {
    expect(interleave(main, exploration)).toEqual(interleave(main, exploration))
  })
})

describe('rankCandidates personalized', () => {
  it('interleaves popular exploration items into the similarity order', () => {
    const candidates = [
      ...Array.from({ length: 8 }, (_, i) =>
        cand(`s${i}`, { similarity: 0.9 - i * 0.01, score: 0.1 }),
      ),
      cand('hot', { similarity: 0, score: 1, publishedAt: hoursAgo(0) }),
    ]
    const ids = rankCandidates(candidates, warm)
    expect(ids).toHaveLength(9)
    expect(ids[4]).toBe('hot')
    expect(ids.slice(0, 4)).toEqual(['s0', 's1', 's2', 's3'])
  })

  it('is stable across calls with the same asOf (pagination by offset)', () => {
    const candidates = Array.from({ length: 30 }, (_, i) =>
      cand(`i${i}`, {
        similarity: ((i * 7) % 10) / 10,
        score: (i % 5) / 5,
        publishedAt: hoursAgo(i),
      }),
    )
    expect(rankCandidates(candidates, warm)).toEqual(
      rankCandidates([...candidates].reverse(), warm),
    )
  })
})

describe('stalePenalty', () => {
  const asOf = new Date('2026-11-09T00:00:00Z')
  const ago = (days: number) => new Date(asOf.getTime() - days * 86_400_000)

  it('does not touch items up to a week old', () => {
    expect(stalePenalty(ago(0), asOf)).toBe(1)
    expect(stalePenalty(ago(7), asOf)).toBe(1)
  })

  it('halves the score every few days past a week', () => {
    expect(stalePenalty(ago(10), asOf)).toBeCloseTo(0.5)
    expect(stalePenalty(ago(13), asOf)).toBeCloseTo(0.25)
  })

  it('ranks a fresh mid-score item above a stale top-score one', () => {
    const ctx = { asOf, signalCount: 0, profileTopics: [] }
    const stale = { id: 's', score: 1, publishedAt: ago(10), topics: [], similarity: null }
    const fresh = { id: 'f', score: 0.4, publishedAt: ago(1), topics: [], similarity: null }
    expect(mainScore(fresh, ctx)).toBeGreaterThan(mainScore(stale, ctx))
  })
})

describe('topicOverlap', () => {
  it('matches raw labels and followed slugs', () => {
    expect(topicOverlap(['ai'], ['ai'])).toBe(true)
    expect(topicOverlap(['claude code'], ['claude-code'])).toBe(true)
    expect(topicOverlap(['rust'], ['claude-code'])).toBe(false)
  })
})
