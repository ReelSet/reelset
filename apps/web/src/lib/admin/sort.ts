export type SortDir = 'asc' | 'desc'
export type SortState<K extends string> = { key: K; dir: SortDir }
export type SortNames = { sort: string; dir: string }
export type SearchParams = Record<string, string | string[] | undefined>

export const DEFAULT_SORT_NAMES: SortNames = { sort: 'sort', dir: 'dir' }

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

// Only keys present in the whitelist survive; anything else falls back to the default sort.
export function parseSort<K extends string>(
  sp: SearchParams,
  allowed: readonly K[],
  fallback: SortState<K>,
  names: SortNames = DEFAULT_SORT_NAMES,
): SortState<K> {
  const rawKey = first(sp[names.sort])
  const key = allowed.find((k) => k === rawKey)
  if (!key) return fallback
  const rawDir = first(sp[names.dir])
  const dir: SortDir = rawDir === 'asc' || rawDir === 'desc' ? rawDir : fallback.dir
  return { key, dir }
}

export function sortParams<K extends string>(
  state: SortState<K>,
  fallback: SortState<K>,
  names: SortNames = DEFAULT_SORT_NAMES,
): Record<string, string | undefined> {
  if (state.key === fallback.key && state.dir === fallback.dir) return {}
  return { [names.sort]: state.key, [names.dir]: state.dir }
}

export function nextDir(current: SortDir | null, firstDir: SortDir): SortDir {
  if (current === null) return firstDir
  return current === 'asc' ? 'desc' : 'asc'
}
