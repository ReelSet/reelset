import { describe, expect, it } from 'vitest'
import {
  buildPeriods,
  buildSeries,
  dayKeysEndingAt,
  formatCompact,
  formatDayKey,
  formatDelta,
  formatMetricValue,
  parseRange,
  pctChange,
  shiftDayKey,
  zeroFill,
} from './stats'

describe('parseRange', () => {
  it('accepts the supported ranges', () => {
    expect(parseRange('7d')).toBe(7)
    expect(parseRange('30d')).toBe(30)
    expect(parseRange('90d')).toBe(90)
  })

  it('falls back to 30d for anything else', () => {
    for (const bad of [undefined, '', '14d', '30', 'abc', '9999d', '-7d']) {
      expect(parseRange(bad)).toBe(30)
    }
  })

  it('uses the first value of a repeated param', () => {
    expect(parseRange(['90d', '7d'])).toBe(90)
  })
})

describe('day keys', () => {
  it('shifts across month and year boundaries', () => {
    expect(shiftDayKey('2026-03-01', -1)).toBe('2026-02-28')
    expect(shiftDayKey('2026-01-01', -1)).toBe('2025-12-31')
    expect(shiftDayKey('2026-12-31', 1)).toBe('2027-01-01')
  })

  it('lists days oldest to newest ending at the key', () => {
    expect(dayKeysEndingAt('2026-11-15', 3)).toEqual(['2026-11-13', '2026-11-14', '2026-11-15'])
  })
})

describe('buildPeriods', () => {
  it('ends today in the viewer zone, not UTC', () => {
    const now = new Date('2026-11-15T22:00:00Z')
    expect(buildPeriods(now, 'UTC', 7).days.at(-1)).toBe('2026-11-15')
    expect(buildPeriods(now, 'Asia/Kolkata', 7).days.at(-1)).toBe('2026-11-16')
    expect(buildPeriods(now, 'America/Los_Angeles', 7).days.at(-1)).toBe('2026-11-15')
  })

  it('previous period is the equal window directly before', () => {
    const p = buildPeriods(new Date('2026-11-15T12:00:00Z'), 'UTC', 7)
    expect(p.days).toHaveLength(7)
    expect(p.prevDays).toHaveLength(7)
    expect(p.days[0]).toBe('2026-11-09')
    expect(p.prevDays.at(-1)).toBe('2026-11-08')
  })
})

describe('zeroFill', () => {
  it('fills missing days with 0 and ignores days outside the window', () => {
    const rows = [
      { day: '2026-11-14', value: 4 },
      { day: '2026-10-01', value: 99 },
    ]
    expect(zeroFill(rows, ['2026-11-13', '2026-11-14', '2026-11-15'])).toEqual([0, 4, 0])
  })

  it('adds duplicate day rows', () => {
    const rows = [
      { day: '2026-11-14', value: 1 },
      { day: '2026-11-14', value: 2 },
    ]
    expect(zeroFill(rows, ['2026-11-14'])).toEqual([3])
  })
})

describe('pctChange', () => {
  it('computes percent change', () => {
    expect(pctChange(150, 100)).toBe(50)
    expect(pctChange(50, 100)).toBe(-50)
    expect(pctChange(0, 100)).toBe(-100)
  })

  it('is null with no prior data', () => {
    expect(pctChange(10, 0)).toBeNull()
    expect(pctChange(0, 0)).toBeNull()
  })
})

describe('buildSeries', () => {
  const periods = { days: ['d3', 'd4'], prevDays: ['d1', 'd2'] }

  it('pairs each day with the same offset of the previous period', () => {
    const series = buildSeries(
      [
        { day: 'd1', value: 2 },
        { day: 'd2', value: 2 },
        { day: 'd4', value: 6 },
      ],
      periods,
    )
    expect(series.points).toEqual([
      { day: 'd3', value: 0, prevDay: 'd1', prev: 2 },
      { day: 'd4', value: 6, prevDay: 'd2', prev: 2 },
    ])
    expect(series.total).toBe(6)
    expect(series.prevTotal).toBe(4)
    expect(series.deltaPct).toBe(50)
  })

  it('honours explicit totals such as distinct users', () => {
    const series = buildSeries([{ day: 'd4', value: 3 }], periods, { current: 2, previous: 1 })
    expect(series.total).toBe(2)
    expect(series.deltaPct).toBe(100)
  })

  it('handles no data at all', () => {
    const series = buildSeries([], periods)
    expect(series.total).toBe(0)
    expect(series.deltaPct).toBeNull()
    expect(series.points.every((p) => p.value === 0)).toBe(true)
  })
})

describe('formatting', () => {
  it('formats counts and usd', () => {
    expect(formatMetricValue(12345, 'count')).toBe('12,345')
    expect(formatMetricValue(0.1234, 'usd')).toBe('$0.1234')
    expect(formatMetricValue(12.345, 'usd')).toBe('$12.35')
    expect(formatCompact(12345, 'count')).toBe('12.3K')
  })

  it('formats deltas with sign', () => {
    expect(formatDelta(12.34)).toBe('+12.3%')
    expect(formatDelta(-5)).toBe('-5.0%')
    expect(formatDelta(250.4)).toBe('+250%')
  })

  it('formats a day key without shifting the date', () => {
    expect(formatDayKey('2026-11-15')).toBe('15 Nov')
  })
})
