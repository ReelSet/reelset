import { describe, expect, it } from 'vitest'
import {
  boxRunStats,
  buildDailyRows,
  busySecondsByBoxDay,
  dayCapacity,
  dayRange,
  dayStats,
  fmtAgo,
  hourRange,
  onlineFraction,
  p95,
  runInterval,
  percentile,
  utilization,
  type RenderRun,
} from './capacity'

const d = (s: string) => new Date(s)
const run = (over: Partial<RenderRun>): RenderRun => ({
  box: 'box1',
  status: 'done',
  startedAt: null,
  finishedAt: null,
  renderMs: null,
  ...over,
})

describe('percentile', () => {
  it('interpolates and handles empty', () => {
    expect(p95([])).toBeNull()
    expect(p95([5])).toBe(5)
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3)
    expect(p95(Array.from({ length: 101 }, (_, i) => i))).toBe(95)
  })
})

describe('dayRange / hourRange', () => {
  it('fills days oldest to newest', () => {
    expect(dayRange(d('2026-03-02T10:00:00Z'), 3)).toEqual([
      '2026-02-28',
      '2026-03-01',
      '2026-03-02',
    ])
  })
  it('fills hours', () => {
    const h = hourRange(d('2026-03-02T10:30:00Z'), 2)
    expect(h).toEqual(['2026-03-02T09:00:00.000Z', '2026-03-02T10:00:00.000Z'])
  })
})

describe('busySecondsByBoxDay', () => {
  it('clips runs that cross midnight', () => {
    const r = run({ startedAt: d('2026-03-01T23:00:00Z'), finishedAt: d('2026-03-02T01:00:00Z') })
    const busy = busySecondsByBoxDay([r], ['2026-03-01', '2026-03-02'])
    expect(busy.get('box1')?.get('2026-03-01')).toBe(3600)
    expect(busy.get('box1')?.get('2026-03-02')).toBe(3600)
  })

  it('prefers the box-measured render time over a started_at reset by a re-check', () => {
    const r = run({
      startedAt: d('2026-03-02T00:59:00Z'),
      finishedAt: d('2026-03-02T01:00:00Z'),
      renderMs: 70 * 60_000,
    })
    expect(runInterval(r)).toEqual([
      d('2026-03-01T23:50:00Z').getTime(),
      d('2026-03-02T01:00:00Z').getTime(),
    ])
  })
  it('falls back to render_ms and counts failed, ignoring running and box-less', () => {
    const rs = [
      run({ status: 'failed', finishedAt: d('2026-03-02T05:00:00Z'), renderMs: 1800_000 }),
      run({ status: 'rendering', startedAt: d('2026-03-02T01:00:00Z') }),
      run({ box: null, finishedAt: d('2026-03-02T05:00:00Z'), renderMs: 1000 }),
    ]
    expect(busySecondsByBoxDay(rs, ['2026-03-02']).get('box1')?.get('2026-03-02')).toBe(1800)
  })
})

describe('onlineFraction', () => {
  it('uses samples, else rendered fallback', () => {
    expect(onlineFraction({ box: 'a', day: 'x', total: 10, ok: 5 }, false)).toBe(0.5)
    expect(onlineFraction(undefined, true)).toBe(1)
    expect(onlineFraction(undefined, false)).toBe(0)
  })
})

describe('dayCapacity and utilization', () => {
  it('prefers day avg with 2+ renders, then trailing, then 75 min', () => {
    expect(dayCapacity(86400 * 2, 3600, 2, 7200)).toBe(48)
    expect(dayCapacity(86400 * 2, 3600, 1, 7200)).toBe(24)
    expect(dayCapacity(86400, null, 0, null)).toBe(Math.floor(86400 / 4500))
    expect(dayCapacity(0, null, 0, null)).toBe(0)
  })
  it('never divides by zero', () => {
    expect(utilization(10, 0)).toBeNull()
    expect(utilization(50, 100)).toBe(0.5)
  })
})

describe('buildDailyRows', () => {
  it('handles no data', () => {
    const now = d('2026-03-02T12:00:00Z')
    const rows = buildDailyRows({
      now,
      days: dayRange(now, 3),
      boxes: [],
      runs: [],
      samples: [],
      instagramByDay: new Map(),
      spendByDay: new Map(),
    })
    expect(rows).toHaveLength(3)
    expect(rows.every((r) => r.capacity === 0 && r.utilization === null && r.rendered === 0)).toBe(
      true,
    )
  })

  it('computes capacity, utilization and joins extras', () => {
    const now = d('2026-03-02T12:00:00Z')
    const runs = [
      run({
        startedAt: d('2026-03-02T00:00:00Z'),
        finishedAt: d('2026-03-02T01:00:00Z'),
        renderMs: 3600_000,
      }),
      run({
        startedAt: d('2026-03-02T01:00:00Z'),
        finishedAt: d('2026-03-02T03:00:00Z'),
        renderMs: 7200_000,
      }),
    ]
    const [row] = buildDailyRows({
      now,
      days: ['2026-03-02'],
      boxes: ['box1', 'box2'],
      runs,
      samples: [{ box: 'box1', day: '2026-03-02', total: 100, ok: 100 }],
      instagramByDay: new Map([['2026-03-02', 2]]),
      spendByDay: new Map([['2026-03-02', 1.5]]),
    })
    // box1 online 12h, box2 no samples and no renders -> 0; avg 5400s
    expect(row!.rendered).toBe(2)
    expect(row!.capacity).toBe(Math.floor(43200 / 5400))
    expect(row!.utilization).toBeCloseTo(10800 / 43200)
    expect(row!.avgMinutes).toBeCloseTo(90)
    expect(row!.instagram).toBe(2)
    expect(row!.spendUsd).toBe(1.5)
  })
})

describe('dayStats and boxRunStats', () => {
  it('counts failed and p90', () => {
    const rs = [
      run({ finishedAt: d('2026-03-02T01:00:00Z'), renderMs: 60_000 }),
      run({ finishedAt: d('2026-03-02T02:00:00Z'), renderMs: 120_000 }),
      run({ status: 'failed', finishedAt: d('2026-03-02T03:00:00Z') }),
    ]
    const s = dayStats(rs, ['2026-03-02']).get('2026-03-02')!
    expect(s.done).toBe(2)
    expect(s.failed).toBe(1)
    expect(s.avgSeconds).toBe(90)
    expect(s.p90Seconds).toBeCloseTo(114)
  })
  it('summarises per box', () => {
    const now = d('2026-03-02T12:00:00Z')
    const rs = [
      run({
        startedAt: d('2026-03-02T09:00:00Z'),
        finishedAt: d('2026-03-02T10:00:00Z'),
        renderMs: 3600_000,
      }),
      run({ box: 'box2', finishedAt: d('2026-03-02T10:00:00Z'), renderMs: 1000 }),
    ]
    expect(boxRunStats(rs, 'box1', now)).toEqual({ done24h: 1, done7d: 1, busyHoursToday: 1 })
  })
})

describe('fmtAgo', () => {
  it('formats', () => {
    expect(fmtAgo(null)).toBe('-')
    expect(fmtAgo(45)).toBe('45s')
    expect(fmtAgo(3700)).toBe('1h 1m')
  })
})
