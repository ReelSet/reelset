import { describe, expect, it } from 'vitest'
import {
  dayKeyInZone,
  formatInZone,
  nextUtcMidnight,
  nextUtcMonthStart,
  parseTimeZone,
  utcDayResetHint,
  zoneHint,
  zoneLabel,
} from './zone'

const INSTANT = '2026-11-15T11:03:09Z'

describe('parseTimeZone', () => {
  it('accepts valid IANA names and rejects junk', () => {
    expect(parseTimeZone('Asia/Kolkata')).toBe('Asia/Calcutta')
    expect(parseTimeZone('Not/AZone')).toBeNull()
    expect(parseTimeZone('')).toBeNull()
    expect(parseTimeZone(undefined)).toBeNull()
    expect(parseTimeZone('x'.repeat(65))).toBeNull()
  })
})

describe('formatInZone', () => {
  it('applies the +5:30 offset for Asia/Kolkata', () => {
    expect(formatInZone(INSTANT, 'Asia/Kolkata', 'time')).toBe('16:33')
    expect(formatInZone(INSTANT, 'Asia/Kolkata', 'datetime')).toBe('15 Nov, 16:33')
    expect(formatInZone(INSTANT, 'Asia/Kolkata', 'datetime-seconds')).toBe('15 Nov, 16:33:09')
  })

  it('follows DST rules of the zone', () => {
    expect(formatInZone('2026-07-01T12:00:00Z', 'America/New_York', 'time')).toBe('08:00')
    expect(formatInZone('2026-12-01T12:00:00Z', 'America/New_York', 'time')).toBe('07:00')
  })

  it('falls back to UTC for an invalid zone', () => {
    expect(formatInZone(INSTANT, 'Nope/Zone', 'time')).toBe('11:03')
  })

  it('renders a dash for empty or invalid values', () => {
    expect(formatInZone(null, 'UTC')).toBe('-')
    expect(formatInZone('garbage', 'UTC')).toBe('-')
  })

  it('formats date and day styles', () => {
    expect(formatInZone(INSTANT, 'UTC', 'date')).toBe('15 Nov 2026')
    expect(formatInZone(INSTANT, 'UTC', 'day')).toBe('15 Nov')
  })
})

describe('dayKeyInZone', () => {
  it('rolls over to the next day across midnight in the zone', () => {
    const instant = '2026-11-15T19:00:00Z'
    expect(dayKeyInZone(instant, 'UTC')).toBe('2026-11-15')
    expect(dayKeyInZone(instant, 'Asia/Kolkata')).toBe('2026-11-16')
    expect(dayKeyInZone(instant, 'America/Los_Angeles')).toBe('2026-11-15')
  })

  it('returns empty for an invalid instant', () => {
    expect(dayKeyInZone('garbage', 'UTC')).toBe('')
  })
})

describe('month-year style', () => {
  it('formats the member-since label', () => {
    expect(formatInZone('2026-11-15T11:03:09Z', 'UTC', 'month-year')).toBe('November 2026')
  })
})

describe('zoneLabel', () => {
  it('labels the offset', () => {
    expect(zoneLabel('Asia/Kolkata', new Date(INSTANT))).toBe('GMT+5:30')
    expect(zoneLabel('UTC', new Date(INSTANT))).toBe('UTC')
  })
})

describe('UTC reset helpers', () => {
  it('finds the next UTC midnight and month start', () => {
    const now = new Date('2026-11-15T11:03:09Z')
    expect(nextUtcMidnight(now).toISOString()).toBe('2026-11-16T00:00:00.000Z')
    expect(nextUtcMonthStart(now).toISOString()).toBe('2026-12-01T00:00:00.000Z')
    expect(nextUtcMonthStart(new Date('2026-12-31T23:00:00Z')).toISOString()).toBe(
      '2027-01-01T00:00:00.000Z',
    )
  })

  it('shows the UTC reset in the viewer clock', () => {
    const now = new Date('2026-11-15T11:03:09Z')
    expect(utcDayResetHint('Asia/Kolkata', now)).toBe(
      'Days are UTC days, resetting at 05:30 your time.',
    )
    expect(zoneHint('Asia/Kolkata', now)).toBe('Times in GMT+5:30.')
  })
})
