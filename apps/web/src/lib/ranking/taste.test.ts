import { describe, expect, it } from 'vitest'
import { EMBEDDING_DIMENSIONS } from '@reelset/core'
import { isQualifyingCompletion, l2Normalize, tasteVector, weightedMean } from './taste'

const vec = (head: number[]) => {
  const v = new Array<number>(EMBEDDING_DIMENSIONS).fill(0)
  head.forEach((x, i) => (v[i] = x))
  return v
}

describe('weightedMean', () => {
  it('weights likes at 1.0 and completions at 0.5', () => {
    const mean = weightedMean([
      { vector: vec([1, 0]), weight: 1 },
      { vector: vec([0, 1]), weight: 0.5 },
    ])
    expect(mean?.[0]).toBeCloseTo(1 / 1.5)
    expect(mean?.[1]).toBeCloseTo(0.5 / 1.5)
  })

  it('returns null for no usable input and skips wrong-sized vectors', () => {
    expect(weightedMean([])).toBeNull()
    expect(weightedMean([{ vector: [1, 2], weight: 1 }])).toBeNull()
    expect(weightedMean([{ vector: vec([1]), weight: 0 }])).toBeNull()
    expect(
      weightedMean([
        { vector: [1, 2], weight: 1 },
        { vector: vec([2]), weight: 1 },
      ])?.[0],
    ).toBe(2)
  })
})

describe('l2Normalize / tasteVector', () => {
  it('returns a unit vector', () => {
    const out = tasteVector([{ vector: vec([3, 4]), weight: 1 }])
    expect(out?.[0]).toBeCloseTo(0.6)
    expect(out?.[1]).toBeCloseTo(0.8)
  })

  it('rejects the zero vector', () => {
    expect(l2Normalize(vec([]))).toBeNull()
  })
})

describe('isQualifyingCompletion', () => {
  it('needs reel_complete with watchRatio >= 0.8', () => {
    expect(isQualifyingCompletion('reel_complete', { watchRatio: 0.8 })).toBe(true)
    expect(isQualifyingCompletion('reel_complete', { watchRatio: 0.79 })).toBe(false)
    expect(isQualifyingCompletion('reel_complete', { watchRatio: '0.9' })).toBe(false)
    expect(isQualifyingCompletion('reel_complete', undefined)).toBe(false)
    expect(isQualifyingCompletion('reel_start', { watchRatio: 1 })).toBe(false)
  })
})
