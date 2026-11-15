export const DRAWER_KINDS = ['item', 'user'] as const
export type DrawerKind = (typeof DRAWER_KINDS)[number]
export type DrawerRef = { kind: DrawerKind; id: string }

const INSTAGRAM_SEGMENT = '/instagram'
// Same shape as z.guid(); kept as a regex so the client bundle does not ship zod.
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function parseDrawerId(raw: unknown): string | null {
  return typeof raw === 'string' && GUID.test(raw) ? raw : null
}

// The Instagram page already owns ?item= (its composer), so its drawer uses ?drawer=.
export function drawerParam(kind: DrawerKind, pathname: string): string {
  if (kind === 'user') return 'user'
  return pathname.replace(/\/+$/, '').endsWith(INSTAGRAM_SEGMENT) ? 'drawer' : 'item'
}

export function readDrawerRef(search: string, pathname: string): DrawerRef | null {
  const params = new URLSearchParams(search)
  for (const kind of DRAWER_KINDS) {
    const id = parseDrawerId(params.get(drawerParam(kind, pathname)))
    if (id) return { kind, id }
  }
  return null
}

// Returns the query string ("?a=b" or "") with the drawer param set to ref, or cleared when null.
export function withDrawerRef(search: string, pathname: string, ref: DrawerRef | null): string {
  const params = new URLSearchParams(search)
  for (const kind of DRAWER_KINDS) params.delete(drawerParam(kind, pathname))
  if (ref) params.set(drawerParam(ref.kind, pathname), ref.id)
  const query = params.toString()
  return query ? `?${query}` : ''
}

// The drawer lives in the URL hash (#item=<id>, #user=<id>): the hash never reaches the server, so
// opening a drawer leaves the page's search params, and so its RSC segment key, untouched. A
// search-param drawer made every AutoRefresh router.refresh() re-render the page as a new segment,
// which reset the scroll and left the top loader running on the rewritten admin host.
export function readDrawerHash(hash: string): DrawerRef | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  for (const kind of DRAWER_KINDS) {
    const id = parseDrawerId(params.get(kind))
    if (id) return { kind, id }
  }
  return null
}

export function drawerHash(ref: DrawerRef | null): string {
  return ref ? `#${ref.kind}=${ref.id}` : ''
}

// Server actions only redirect to /admin/... paths, but admin.reelset.app shows them without the prefix.
export function adminReturnPath(pathname: string, search: string): string {
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return `${pathname}${search}`
  return `/admin${pathname === '/' ? '' : pathname}${search}`
}

export function isSameRef(a: DrawerRef | null, b: DrawerRef | null): boolean {
  return a?.kind === b?.kind && a?.id === b?.id
}
