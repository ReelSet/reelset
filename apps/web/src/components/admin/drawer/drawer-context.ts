'use client'

import { createContext, useContext } from 'react'
import type { ItemPreview, UserPreview } from '@/lib/admin/drawer-types'
import type { DrawerKind } from '@/lib/admin/drawer-url'

export type DrawerTarget =
  | { kind: 'item'; id: string; preview?: ItemPreview }
  | { kind: 'user'; id: string; preview?: UserPreview }

export type DrawerApi = {
  open: (target: DrawerTarget, trigger: Element | null) => void
  prefetch: (kind: DrawerKind, id: string) => void
}

export const DrawerContext = createContext<DrawerApi | null>(null)

/** Null outside the admin layout; links then fall back to plain navigation. */
export const useAdminDrawer = () => useContext(DrawerContext)
