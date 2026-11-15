import { describe, expect, it } from 'vitest'
import {
  formatDuration,
  previewByteLimit,
  pickShowcase,
  playingIndices,
  type ShowcaseCandidate,
} from './showcase'

const url = (key: string) => `https://m.test/${key}`
const id = (n: number) => `${String(n).padStart(8, '0')}-0000-0000-0000-000000000000`

function cand(n: number, source: string, score: number, over: Partial<ShowcaseCandidate> = {}) {
  return {
    id: id(n),
    title: `Reel ${n}`,
    source,
    score,
    video_key: `v${n}.mp4`,
    poster_key: `v${n}.jpg`,
    video_duration_ms: 42000,
    ...over,
  }
}

describe('pickShowcase', () => {
  it('takes the best reel per source, in source preference order', () => {
    const picked = pickShowcase(
      [cand(1, 'hn', 5), cand(2, 'hn', 9), cand(3, 'youtube', 700), cand(4, 'reddit', 3)],
      url,
    )
    expect(picked.map((p) => p.id)).toEqual([id(2), id(4), id(3)])
  })

  it('never shows GitHub or unknown sources', () => {
    const picked = pickShowcase(
      [cand(1, 'github', 99), cand(2, 'hn', 1), cand(3, 'reddit', 1), cand(4, 'x', 99)],
      url,
    )
    expect(picked).toEqual([])
  })

  it('returns nothing when fewer than the requested count remain', () => {
    expect(pickShowcase([cand(1, 'hn', 1), cand(2, 'hn', 2), cand(3, 'reddit', 1)], url)).toEqual(
      [],
    )
  })

  it('builds media urls and a reel link, tolerating a missing poster', () => {
    const [first] = pickShowcase(
      [cand(1, 'hn', 3, { poster_key: null }), cand(2, 'reddit', 2), cand(3, 'news', 1)],
      url,
    )
    expect(first).toMatchObject({
      videoUrl: 'https://m.test/v1.mp4',
      posterUrl: null,
      href: '/r/reel-1-00000001',
    })
  })

  it('skips blank titles', () => {
    const picked = pickShowcase(
      [cand(1, 'hn', 9, { title: '  ' }), cand(2, 'reddit', 2), cand(3, 'news', 1)],
      url,
      2,
    )
    expect(picked.map((p) => p.source)).toEqual(['reddit', 'news'])
  })
})

describe('pickShowcase titles', () => {
  it('skips titles too long for a card', () => {
    const picked = pickShowcase(
      [cand(1, 'hn', 9, { title: 'x'.repeat(120) }), cand(2, 'reddit', 2), cand(3, 'news', 1)],
      url,
      2,
    )
    expect(picked.map((p) => p.source)).toEqual(['reddit', 'news'])
  })
})

describe('formatDuration', () => {
  it('formats m:ss', () => expect(formatDuration(42400)).toBe('0:42'))
  it('rolls over minutes', () => expect(formatDuration(65000)).toBe('1:05'))
  it('is null for unknown or zero', () => {
    expect(formatDuration(null)).toBeNull()
    expect(formatDuration(0)).toBeNull()
  })
})

describe('playingIndices', () => {
  it('plays every sufficiently visible card on desktop', () => {
    expect([...playingIndices([0.9, 1, 0.2], false)]).toEqual([0, 1])
  })
  it('plays only the most visible card on mobile', () => {
    expect([...playingIndices([0.7, 0.95, 0.65], true)]).toEqual([1])
  })
  it('plays nothing when no card is visible enough', () => {
    expect(playingIndices([0.1, 0, 0.3], true).size).toBe(0)
  })
})

describe('previewByteLimit', () => {
  it('scales with the preview share', () => {
    expect(previewByteLimit(10_000_000, 30_000, 3)).toBe(1_000_000)
  })
  it('never exceeds the file', () => {
    expect(previewByteLimit(500_000, 2_000, 4)).toBe(500_000)
  })
  it('has a floor and a fallback for unknown durations', () => {
    expect(previewByteLimit(100_000_000, 10_000_000, 4)).toBe(256 * 1024)
    expect(previewByteLimit(50_000_000, null)).toBe(1024 * 1024)
  })
})
