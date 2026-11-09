import { describe, expect, it } from 'vitest'
import { nextWatermark, planRange, publishedBounds } from '../src/ingest/range'
import { hackerNewsAdapter } from '../src/sources/hacker-news'
import { youtubeAdapter } from '../src/sources/youtube'
import type { Watermark } from '../src/types'

const now = new Date('2026-11-09T12:00:00Z')
const d = (s: string) => new Date(s)
const wm = (over: Partial<Watermark> = {}): Watermark => ({
  source: 'hn',
  scope: 'stories',
  lane: 'default',
  newestAt: null,
  oldestAt: null,
  nextToken: null,
  backfillComplete: false,
  ...over,
})

describe('planRange', () => {
  it('cold start incremental reads the last 24h', () => {
    const plan = planRange({}, 'incremental', null, now)
    expect(plan).toEqual({ skip: false, range: { after: d('2026-11-08T12:00:00Z'), before: null } })
  })
  it('incremental resumes from the watermark minus a 2h overlap', () => {
    const plan = planRange({}, 'incremental', wm({ newestAt: d('2026-11-09T10:00:00Z') }), now)
    expect(plan).toEqual({ skip: false, range: { after: d('2026-11-09T08:00:00Z'), before: null } })
  })
  it('rolling-window adapters ignore the watermark', () => {
    const plan = planRange(
      { rollingWindowMs: 7 * 86_400_000 },
      'incremental',
      wm({ newestAt: d('2026-11-09T10:00:00Z') }),
      now,
    )
    expect(plan).toEqual({ skip: false, range: { after: d('2026-11-02T12:00:00Z'), before: null } })
  })
  it('hacker news re-reads a 24h rolling window', () => {
    const plan = planRange(
      hackerNewsAdapter,
      'incremental',
      wm({ newestAt: d('2026-11-09T10:00:00Z') }),
      now,
    )
    expect(plan).toEqual({ skip: false, range: { after: d('2026-11-08T12:00:00Z'), before: null } })
  })
  it('youtube never narrows its search window to the watermark', () => {
    const plan = planRange(
      youtubeAdapter,
      'incremental',
      wm({ source: 'youtube', newestAt: d('2026-11-09T10:00:00Z') }),
      now,
    )
    expect(plan).toEqual({ skip: false, range: { after: d('2026-10-10T12:00:00Z'), before: null } })
  })
  it('backfill walks backwards from the oldest seen item', () => {
    const plan = planRange({}, 'backfill', wm({ oldestAt: d('2026-11-05T00:00:00Z') }), now)
    expect(plan).toEqual({
      skip: false,
      range: { after: d('2026-10-26T12:00:00Z'), before: d('2026-11-05T00:00:00Z') },
    })
  })
  it('backfill is skipped once complete or when the window is covered', () => {
    expect(planRange({}, 'backfill', wm({ backfillComplete: true }), now)).toEqual({
      skip: true,
      reason: 'backfill_complete',
    })
    expect(planRange({}, 'backfill', wm({ oldestAt: d('2026-10-01T00:00:00Z') }), now)).toEqual({
      skip: true,
      reason: 'backfill_window_covered',
    })
  })
})

describe('nextWatermark', () => {
  const seen = { newest: d('2026-11-09T11:00:00Z'), oldest: d('2026-11-09T01:00:00Z') }

  it('incremental advances newest and keeps the backfill state', () => {
    const next = nextWatermark(
      wm({ newestAt: d('2026-11-09T05:00:00Z'), oldestAt: d('2026-11-01T00:00:00Z') }),
      'incremental',
      seen,
      true,
    )
    expect(next).toEqual({
      newestAt: seen.newest,
      oldestAt: d('2026-11-01T00:00:00Z'),
      backfillComplete: false,
    })
  })
  it('incremental never moves newest backwards', () => {
    const next = nextWatermark(
      wm({ newestAt: d('2026-11-09T11:30:00Z') }),
      'incremental',
      seen,
      true,
    )
    expect(next.newestAt).toEqual(d('2026-11-09T11:30:00Z'))
  })
  it('first incremental run seeds oldest from what it saw', () => {
    expect(nextWatermark(null, 'incremental', seen, true).oldestAt).toEqual(seen.oldest)
  })
  it('backfill moves oldest backwards and completes when the source is exhausted', () => {
    const next = nextWatermark(
      wm({ newestAt: d('2026-11-09T10:00:00Z'), oldestAt: d('2026-11-05T00:00:00Z') }),
      'backfill',
      { newest: d('2026-11-04T00:00:00Z'), oldest: d('2026-10-30T00:00:00Z') },
      true,
    )
    expect(next).toEqual({
      newestAt: d('2026-11-09T10:00:00Z'),
      oldestAt: d('2026-10-30T00:00:00Z'),
      backfillComplete: true,
    })
  })
  it('backfill stays incomplete when the page budget ran out', () => {
    expect(nextWatermark(null, 'backfill', seen, false).backfillComplete).toBe(false)
  })
  it('keeps existing bounds when nothing was fetched', () => {
    const prev = wm({ newestAt: d('2026-11-09T10:00:00Z'), oldestAt: d('2026-11-05T00:00:00Z') })
    expect(nextWatermark(prev, 'incremental', { newest: null, oldest: null }, true)).toEqual({
      newestAt: prev.newestAt,
      oldestAt: prev.oldestAt,
      backfillComplete: false,
    })
  })
})

describe('publishedBounds', () => {
  it('finds min and max', () => {
    expect(
      publishedBounds([
        { publishedAt: d('2026-01-02') },
        { publishedAt: d('2026-01-01') },
        { publishedAt: d('2026-01-03') },
      ]),
    ).toEqual({
      newest: d('2026-01-03'),
      oldest: d('2026-01-01'),
    })
    expect(publishedBounds([])).toEqual({ newest: null, oldest: null })
  })
})
