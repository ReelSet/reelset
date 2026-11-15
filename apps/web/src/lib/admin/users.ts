import { z } from 'zod'
import type { SortState } from './sort'

export const USER_PAGE_SIZE = 25
export const USER_SEARCH_MAX = 80
export const USER_SORT_KEYS = ['joined', 'active', 'reels'] as const
export type UserSortKey = (typeof USER_SORT_KEYS)[number]
export const DEFAULT_USER_SORT: SortState<UserSortKey> = { key: 'joined', dir: 'desc' }

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

export function parseUserSearch(raw: string | string[] | undefined): string | null {
  return first(raw)?.trim().slice(0, USER_SEARCH_MAX) || null
}

// Escapes LIKE wildcards so the search text always matches literally.
export function ilikePattern(search: string): string {
  return `%${search.replace(/[\\%_]/g, '\\$&')}%`
}

export function parseUserId(raw: string | string[] | undefined): string | null {
  const parsed = z.guid().safeParse(first(raw))
  return parsed.success ? parsed.data : null
}

export function creditsUsedFrom(monthDeltaSumExcludingGrants: number): number {
  return Math.max(0, -monthDeltaSumExcludingGrants)
}

export {
  providerLabel,
  userAvatarUrl,
  userDisplay,
  type UserAvatarInput,
  type UserIdentityInput,
} from './user-display'
