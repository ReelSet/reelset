import { describe, expect, it } from 'vitest'
import { CAP_EXEMPT_STATUSES, dayShare, pacedCap } from './admission'

describe('admission pacing', () => {
  it('opens one hour of the day at midnight and all of it from 23:00 UTC', () => {
    expect(dayShare(new Date('2026-11-25T00:00:00Z'))).toBeCloseTo(1 / 24)
    expect(dayShare(new Date('2026-11-25T11:00:00Z'))).toBeCloseTo(0.5)
    expect(dayShare(new Date('2026-11-25T23:00:00Z'))).toBe(1)
    expect(dayShare(new Date('2026-11-25T23:59:59Z'))).toBe(1)
  })
  it('rounds open slots up and never passes the daily cap', () => {
    expect(pacedCap(25, new Date('2026-11-25T00:00:00Z'))).toBe(2)
    expect(pacedCap(25, new Date('2026-11-25T12:00:00Z'))).toBe(14)
    expect(pacedCap(25, new Date('2026-11-25T23:30:00Z'))).toBe(25)
    expect(pacedCap(0, new Date('2026-11-25T12:00:00Z'))).toBe(0)
  })
  it('gives back slots of items that never become a reel', () => {
    expect(CAP_EXEMPT_STATUSES).toEqual(['failed', 'insufficient_source', 'source_only'])
  })
})
