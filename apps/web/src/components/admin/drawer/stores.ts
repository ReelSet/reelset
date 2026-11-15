import type { ItemDrawerData, UserDrawerData } from '@/lib/admin/drawer-types'
import type { DrawerKind } from '@/lib/admin/drawer-url'
import { createDetailStore, type DetailStore } from './detail-store'

function hasId(json: unknown, pick: (value: Record<string, unknown>) => unknown, id: string) {
  const value = typeof json === 'object' && json !== null ? (json as Record<string, unknown>) : null
  const inner = value ? pick(value) : null
  if (typeof inner !== 'object' || inner === null || (inner as { id?: unknown }).id !== id) {
    throw new Error('response does not match the requested id')
  }
}

export const itemStore = createDetailStore<ItemDrawerData>({
  url: (id) => `/api/admin/items/${id}`,
  parse: (json, id) => {
    hasId(json, (v) => v.item, id)
    return json as ItemDrawerData
  },
})

export const userStore = createDetailStore<UserDrawerData>({
  url: (id) => `/api/admin/users/${id}`,
  parse: (json, id) => {
    hasId(json, (v) => v.user, id)
    return json as UserDrawerData
  },
})

const STORES: Record<DrawerKind, DetailStore<unknown>> = { item: itemStore, user: userStore }

export const storeFor = (kind: DrawerKind): DetailStore<unknown> => STORES[kind]
