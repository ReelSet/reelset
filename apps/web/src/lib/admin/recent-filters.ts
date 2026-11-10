import { ItemStatus } from '@reelset/core'

export const STATUS_GROUPS = {
  all: { label: 'All', statuses: [] as ItemStatus[] },
  active: {
    label: 'Active',
    statuses: [ItemStatus.found, ItemStatus.summarized, ItemStatus.embedded, ItemStatus.voiced],
  },
  live: { label: 'Live', statuses: [ItemStatus.rendered] },
  failed: { label: 'Failed', statuses: [ItemStatus.failed] },
  skipped: { label: 'Skipped', statuses: [ItemStatus.insufficient_source] },
} as const

export type StatusGroup = keyof typeof STATUS_GROUPS

export const RANGES = {
  '1h': { label: '1h', ms: 3_600_000 },
  '24h': { label: '24h', ms: 86_400_000 },
  '7d': { label: '7d', ms: 7 * 86_400_000 },
  all: { label: 'All time', ms: null },
} as const

export type RangeKey = keyof typeof RANGES

export type RecentFilters = {
  group: StatusGroup
  statuses: ItemStatus[]
  source: string | null
  range: RangeKey
  sinceMs: number | null
  q: string | null
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

export function parseRecentFilters(
  sp: Record<string, string | string[] | undefined>,
  knownSources: readonly string[],
): RecentFilters {
  const rawGroup = first(sp.view)
  const group: StatusGroup =
    rawGroup && rawGroup in STATUS_GROUPS ? (rawGroup as StatusGroup) : 'all'
  const rawRange = first(sp.range)
  const range: RangeKey = rawRange && rawRange in RANGES ? (rawRange as RangeKey) : '24h'
  const rawSource = first(sp.source)
  const q = first(sp.q)?.trim().slice(0, 80)
  return {
    group,
    statuses: [...STATUS_GROUPS[group].statuses],
    source: rawSource && knownSources.includes(rawSource) ? rawSource : null,
    range,
    sinceMs: RANGES[range].ms,
    q: q ? q : null,
  }
}

export function filtersToParams(f: RecentFilters): Record<string, string | undefined> {
  return {
    view: f.group === 'all' ? undefined : f.group,
    source: f.source ?? undefined,
    range: f.range === '24h' ? undefined : f.range,
    q: f.q ?? undefined,
  }
}
