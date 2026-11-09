export type HostRoute =
  | { kind: 'next' }
  | { kind: 'rewrite'; pathname: string }
  | { kind: 'redirect'; pathname: string }
  | { kind: 'not_found' }

const ADMIN_PREFIX = '/admin'
const PASS_THROUGH_ON_ADMIN = ['/api', '/auth', '/login', '/_next']

function isLocalHost(host: string): boolean {
  const name = host.split(':')[0] ?? ''
  return name === 'localhost' || name === '127.0.0.1' || name.endsWith('.localhost')
}

function startsWithSegment(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

/**
 * admin.reelset.app serves the /admin pages at its root; the main domain never serves /admin.
 * Local hosts keep /admin reachable so development needs no extra DNS.
 */
export function routeForHost(input: {
  host: string | null
  pathname: string
  adminHost: string
}): HostRoute {
  const host = (input.host ?? '').toLowerCase()
  const { pathname } = input
  const onAdminHost = host.split(':')[0] === input.adminHost.toLowerCase()

  if (onAdminHost) {
    if (startsWithSegment(pathname, ADMIN_PREFIX)) {
      return { kind: 'redirect', pathname: pathname.slice(ADMIN_PREFIX.length) || '/' }
    }
    if (PASS_THROUGH_ON_ADMIN.some((prefix) => startsWithSegment(pathname, prefix))) {
      return { kind: 'next' }
    }
    return {
      kind: 'rewrite',
      pathname: pathname === '/' ? ADMIN_PREFIX : `${ADMIN_PREFIX}${pathname}`,
    }
  }

  if (startsWithSegment(pathname, ADMIN_PREFIX) && !isLocalHost(host)) return { kind: 'not_found' }
  return { kind: 'next' }
}
