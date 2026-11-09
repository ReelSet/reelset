import { describe, expect, it } from 'vitest'
import { decideSpendGate, isOverHourlyLimit } from './gate'

describe('decideSpendGate', () => {
  it('allows under the cap', () => {
    expect(decideSpendGate({ spentTodayUsd: 4.99, dailyCapUsd: 5 })).toBe('ok')
  })

  it('caps spend at the daily cap', () => {
    expect(decideSpendGate({ spentTodayUsd: 5, dailyCapUsd: 5 })).toBe('spend_capped')
  })
})

describe('isOverHourlyLimit', () => {
  it('trips at the limit, not before', () => {
    expect(isOverHourlyLimit(19, 20)).toBe(false)
    expect(isOverHourlyLimit(20, 20)).toBe(true)
  })
})
