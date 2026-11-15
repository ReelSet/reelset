'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef } from 'react'
import { DRAWER_PREFETCH_DELAY_MS } from '@/lib/admin/drawer-config'
import { ADMIN_ROUTES } from '@/lib/admin/nav'
import type { ItemPreview, UserPreview } from '@/lib/admin/drawer-types'
import { useAdminDrawer, type DrawerTarget } from './drawer-context'

type Props = {
  target: DrawerTarget
  href: string
  className?: string
  children: React.ReactNode
}

const isPlainLeftClick = (e: React.MouseEvent) =>
  e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey

function DrawerLink({ target, href, className, children }: Props) {
  const drawer = useAdminDrawer()
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const { kind, id } = target

  const cancelPrefetch = useCallback(() => clearTimeout(timer.current), [])
  const schedulePrefetch = useCallback(() => {
    if (!drawer) return
    clearTimeout(timer.current)
    timer.current = setTimeout(() => drawer.prefetch(kind, id), DRAWER_PREFETCH_DELAY_MS)
  }, [drawer, kind, id])
  useEffect(() => cancelPrefetch, [cancelPrefetch])

  const onClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (!drawer || event.defaultPrevented || !isPlainLeftClick(event)) return
    event.preventDefault()
    // nextjs-toploader listens on document and would start its bar for this same-site anchor.
    event.stopPropagation()
    cancelPrefetch()
    drawer.open(target, event.currentTarget)
  }

  return (
    <Link
      href={href}
      scroll={false}
      prefetch={false}
      onClick={onClick}
      onPointerEnter={schedulePrefetch}
      onPointerLeave={cancelPrefetch}
      onFocus={schedulePrefetch}
      onBlur={cancelPrefetch}
      className={className}
    >
      {children}
    </Link>
  )
}

type ItemLinkProps = ItemPreview & {
  id: string
  href?: string
  className?: string
  children: React.ReactNode
}

/** Opens the item drawer in place; the href is the pipeline deep link for new tabs and no-JS. */
export function ItemLink({ id, title, source, status, href, className, children }: ItemLinkProps) {
  return (
    <DrawerLink
      target={{ kind: 'item', id, preview: { title, source, status } }}
      href={href ?? `${ADMIN_ROUTES.pipeline}?item=${id}`}
      className={className}
    >
      {children}
    </DrawerLink>
  )
}

type UserLinkProps = UserPreview & {
  id: string
  href: string
  className?: string
  children: React.ReactNode
}

/** Opens the user drawer in place; the href is the users-list deep link. */
export function UserLink({ id, name, href, className, children }: UserLinkProps) {
  return (
    <DrawerLink target={{ kind: 'user', id, preview: { name } }} href={href} className={className}>
      {children}
    </DrawerLink>
  )
}
