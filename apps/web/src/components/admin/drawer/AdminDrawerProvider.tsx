'use client'

import { usePathname, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DRAWER_EXIT_MS } from '@/lib/admin/drawer-config'
import { DRAWER_LIVE_REFRESH_MS, itemDrawerIsLive } from '@/lib/admin/live-refresh'
import {
  adminReturnPath,
  drawerHash,
  isSameRef,
  readDrawerHash,
  readDrawerRef,
  withDrawerRef,
  type DrawerRef,
} from '@/lib/admin/drawer-url'
import { DrawerContext, type DrawerApi, type DrawerTarget } from './drawer-context'
import { DrawerPanel, drawerLabel } from './DrawerPanel'
import { DrawerShell } from './DrawerShell'
import { itemStore, storeFor, userStore } from './stores'

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

function legacyRef(): DrawerRef | null {
  return readDrawerRef(window.location.search, window.location.pathname)
}

// Hash first; ?item= / ?user= only for old deep links and new-tab opens of a row link.
function currentRef(): DrawerRef | null {
  return readDrawerHash(window.location.hash) ?? legacyRef()
}

function urlWith(ref: DrawerRef | null): string {
  const { pathname, search } = window.location
  const query = legacyRef() ? withDrawerRef(search, pathname, null) : search
  return `${pathname}${query}${drawerHash(ref)}`
}

function invalidateStores() {
  itemStore.invalidateAll()
  userStore.invalidateAll()
}

/**
 * Owns the admin detail drawer: opening, closing and switching are client state plus
 * history.pushState, so no server navigation (and no top loader) is involved.
 */
export function AdminDrawerProvider({ children }: { children: React.ReactNode }) {
  const [target, setTarget] = useState<DrawerTarget | null>(null)
  const [open, setOpen] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const shown = useRef<DrawerRef | null>(null)
  const trigger = useRef<Element | null>(null)
  const ownedHref = useRef<string | null>(null)
  const exitTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const pathname = usePathname()
  const searchParams = useSearchParams()
  const search = searchParams.toString()
  const flash = searchParams.get('flash')
  const returnTo = useMemo(
    () => adminReturnPath(pathname, search ? `?${search}` : ''),
    [pathname, search],
  )

  const reveal = useCallback((next: DrawerTarget) => {
    clearTimeout(exitTimer.current)
    shown.current = { kind: next.kind, id: next.id }
    setTarget(next)
    setOpen(true)
  }, [])

  const conceal = useCallback(() => {
    if (!shown.current) return
    shown.current = null
    ownedHref.current = null
    setOpen(false)
    const element = trigger.current
    trigger.current = null
    if (element instanceof HTMLElement && element.isConnected)
      element.focus({ preventScroll: true })
    exitTimer.current = setTimeout(
      () => setTarget(null),
      prefersReducedMotion() ? 0 : DRAWER_EXIT_MS,
    )
  }, [])

  const syncFromUrl = useCallback(() => {
    const ref = currentRef()
    if (isSameRef(ref, shown.current)) return
    // A server action inside the drawer redirects back with ?flash= and no hash: keep it open.
    if (!ref && shown.current && new URLSearchParams(window.location.search).has('flash')) {
      window.history.replaceState(null, '', urlWith(shown.current))
      ownedHref.current = null
      return
    }
    if (ref) reveal({ kind: ref.kind, id: ref.id } as DrawerTarget)
    else conceal()
  }, [reveal, conceal])

  const openDrawer = useCallback<DrawerApi['open']>(
    (next, from) => {
      if (isSameRef(next, shown.current)) return
      const wasOpen = shown.current !== null
      if (!wasOpen) trigger.current = from
      const url = urlWith({ kind: next.kind, id: next.id })
      if (wasOpen) {
        window.history.replaceState(null, '', url)
        if (ownedHref.current) ownedHref.current = window.location.href
      } else {
        window.history.pushState(null, '', url)
        ownedHref.current = window.location.href
      }
      reveal(next)
    },
    [reveal],
  )

  const closeDrawer = useCallback(() => {
    const owned = ownedHref.current
    conceal()
    if (owned && window.location.href === owned) window.history.back()
    else if (currentRef()) window.history.replaceState(null, '', urlWith(null))
  }, [conceal])

  useEffect(() => {
    syncFromUrl()
  }, [pathname, search, syncFromUrl])

  useEffect(() => {
    const onPopState = () => {
      ownedHref.current = null
      syncFromUrl()
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [syncFromUrl])

  useEffect(() => {
    if (!flash) return
    invalidateStores()
    setRefreshKey((n) => n + 1)
  }, [flash])

  const liveItemId = target?.kind === 'item' ? target.id : null
  useEffect(() => {
    if (!liveItemId) return
    const tick = () => {
      if (document.visibilityState !== 'visible') return
      if (!itemDrawerIsLive(itemStore.peek(liveItemId))) return
      itemStore.invalidateAll()
      setRefreshKey((n) => n + 1)
    }
    const id = setInterval(tick, DRAWER_LIVE_REFRESH_MS)
    return () => clearInterval(id)
  }, [liveItemId])

  useEffect(() => () => clearTimeout(exitTimer.current), [])

  const api = useMemo<DrawerApi>(
    () => ({ open: openDrawer, prefetch: (kind, id) => storeFor(kind).prefetch(id) }),
    [openDrawer],
  )

  return (
    <DrawerContext.Provider value={api}>
      {children}
      {target ? (
        <DrawerShell
          label={drawerLabel(target.kind)}
          open={open}
          onClose={closeDrawer}
          scrollKey={`${target.kind}:${target.id}`}
        >
          <DrawerPanel target={target} returnTo={returnTo} refreshKey={refreshKey} />
        </DrawerShell>
      ) : null}
    </DrawerContext.Provider>
  )
}
