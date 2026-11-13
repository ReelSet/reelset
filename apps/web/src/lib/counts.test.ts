import { describe, expect, it } from 'vitest'
import { DEFAULT_COUNT_RULES, formatCount, visibleCount } from './counts'

describe('visibleCount', () => {
  it('hides the count when the rule is off, whatever the number', () => {
    expect(visibleCount(5000, { show: false, min: 0 })).toBeNull()
  })

  it('shows only at or above the threshold', () => {
    const rule = { show: true, min: 100 }
    expect(visibleCount(99, rule)).toBeNull()
    expect(visibleCount(100, rule)).toBe(100)
    expect(visibleCount(101, rule)).toBe(101)
  })

  it('a zero threshold shows everything, including zero', () => {
    expect(visibleCount(0, { show: true, min: 0 })).toBe(0)
  })

  it('rejects nonsense counts', () => {
    expect(visibleCount(-1, { show: true, min: 0 })).toBeNull()
    expect(visibleCount(Number.NaN, { show: true, min: 0 })).toBeNull()
  })

  it('defaults hide views and saves and hide a zero like count', () => {
    expect(visibleCount(1000, DEFAULT_COUNT_RULES.views)).toBeNull()
    expect(visibleCount(1000, DEFAULT_COUNT_RULES.saves)).toBeNull()
    expect(visibleCount(0, DEFAULT_COUNT_RULES.likes)).toBeNull()
    expect(visibleCount(1, DEFAULT_COUNT_RULES.likes)).toBe(1)
  })
})

describe('formatCount', () => {
  it.each([
    [0, '0'],
    [999, '999'],
    [1000, '1K'],
    [1234, '1.2K'],
    [9999, '9.9K'],
    [12_500, '12K'],
    [999_999, '999K'],
    [1_000_000, '1M'],
    [1_500_000, '1.5M'],
    [2_000_000_000, '2B'],
  ])('%i -> %s', (n, text) => {
    expect(formatCount(n)).toBe(text)
  })
})
