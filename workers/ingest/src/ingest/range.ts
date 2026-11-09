import type { IngestMode } from '@reelset/core'
import { BACKFILL_WINDOW_MS, INCREMENTAL_COLD_START_MS, INCREMENTAL_OVERLAP_MS } from '../config'
import type { FetchRange, SourceAdapter, Watermark } from '../types'

export type RangePlan = { skip: false; range: FetchRange } | { skip: true; reason: string }

export function planRange(
  adapter: Pick<SourceAdapter, 'rollingWindowMs'>,
  mode: IngestMode,
  watermark: Watermark | null,
  now: Date,
): RangePlan {
  if (mode === 'backfill') {
    if (watermark?.backfillComplete) return { skip: true, reason: 'backfill_complete' }
    const after = new Date(now.getTime() - BACKFILL_WINDOW_MS)
    if (watermark?.oldestAt && watermark.oldestAt <= after) {
      return { skip: true, reason: 'backfill_window_covered' }
    }
    return { skip: false, range: { after, before: watermark?.oldestAt ?? null } }
  }

  if (adapter.rollingWindowMs) {
    return {
      skip: false,
      range: { after: new Date(now.getTime() - adapter.rollingWindowMs), before: null },
    }
  }
  const after = watermark?.newestAt
    ? new Date(watermark.newestAt.getTime() - INCREMENTAL_OVERLAP_MS)
    : new Date(now.getTime() - INCREMENTAL_COLD_START_MS)
  return { skip: false, range: { after, before: null } }
}

function laterOf(a: Date | null, b: Date | null): Date | null {
  if (!a) return b
  if (!b) return a
  return a > b ? a : b
}

function earlierOf(a: Date | null, b: Date | null): Date | null {
  if (!a) return b
  if (!b) return a
  return a < b ? a : b
}

export type WatermarkUpdate = {
  newestAt: Date | null
  oldestAt: Date | null
  backfillComplete: boolean
}

export function nextWatermark(
  prev: Watermark | null,
  mode: IngestMode,
  seen: { newest: Date | null; oldest: Date | null },
  exhausted: boolean,
): WatermarkUpdate {
  const newestAt = laterOf(prev?.newestAt ?? null, seen.newest)
  if (mode === 'backfill') {
    return {
      newestAt,
      oldestAt: earlierOf(prev?.oldestAt ?? null, seen.oldest),
      backfillComplete: prev?.backfillComplete === true || exhausted,
    }
  }
  return {
    newestAt,
    oldestAt: prev?.oldestAt ?? seen.oldest,
    backfillComplete: prev?.backfillComplete ?? false,
  }
}

export function publishedBounds(items: readonly { publishedAt: Date }[]): {
  newest: Date | null
  oldest: Date | null
} {
  let newest: Date | null = null
  let oldest: Date | null = null
  for (const item of items) {
    if (!newest || item.publishedAt > newest) newest = item.publishedAt
    if (!oldest || item.publishedAt < oldest) oldest = item.publishedAt
  }
  return { newest, oldest }
}
