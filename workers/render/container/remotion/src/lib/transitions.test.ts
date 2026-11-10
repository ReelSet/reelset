import { describe, expect, it } from 'vitest'
import { snapHeadlineEnd } from './timeline'
import { TRANSITIONS, overlapFrames, pickTransitions } from './transitions'
import type { ScreenName } from './types'

const shows: ScreenName[] = [
  'RepoPage',
  'KeyPoint',
  'StatSlam',
  'Terminal',
  'ImageFull',
  'KeyPoint',
  'HNThread',
  'EndCard',
]

describe('pickTransitions', () => {
  it('is deterministic and leaves the first shot untouched', () => {
    const a = pickTransitions(shows)
    expect(a).toEqual(pickTransitions(shows))
    expect(a[0]).toBeNull()
  })

  it('never repeats the previous transition and uses more than one kind', () => {
    const long = Array.from({ length: 30 }, (_, i) => shows[i % shows.length]!)
    const t = pickTransitions(long)
    for (let i = 2; i < t.length; i++) expect(t[i]).not.toBe(t[i - 1])
    expect(new Set(t.slice(1)).size).toBeGreaterThanOrEqual(3)
    expect(t.slice(1).every((x) => (TRANSITIONS as readonly string[]).includes(x as string))).toBe(
      true,
    )
  })

  it('keeps the flash to a minority of cuts', () => {
    const long = Array.from({ length: 40 }, (_, i) => shows[(i * 3) % shows.length]!)
    const punches = pickTransitions(long).filter((x) => x === 'punch').length
    expect(punches / 39).toBeLessThan(0.4)
  })
})

describe('overlapFrames', () => {
  it('only moving transitions overlap the previous shot', () => {
    expect(overlapFrames(null)).toBe(0)
    expect(overlapFrames('punch')).toBe(0)
    expect(overlapFrames('cut')).toBe(0)
    expect(overlapFrames('slide')).toBeGreaterThan(0)
  })
})

describe('snapHeadlineEnd', () => {
  it('lands on the nearest shot boundary between 1.7 and 3.4 s', () => {
    const shots = [{ from: 0 }, { from: 45 }, { from: 78 }, { from: 130 }]
    expect(snapHeadlineEnd(2.5, shots, 30)).toBeCloseTo(2.6, 2)
    expect(snapHeadlineEnd(2.0, shots, 30)).toBeCloseTo(2.6, 2)
    expect(snapHeadlineEnd(2.5, [{ from: 0 }, { from: 150 }], 30)).toBe(2.5)
  })
})
