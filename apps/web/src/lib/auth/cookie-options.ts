export const AUTH_COOKIE_MAX_AGE = 60 * 60 * 24 * 400
export const AUTH_DOMAIN_MARKER = 'rs_auth_domain'

export type AuthCookieOptions = {
  domain?: string
  path: string
  sameSite: 'lax'
  secure: boolean
}

function hostname(host: string | null | undefined): string {
  return (host ?? '').toLowerCase().split(':')[0] ?? ''
}

/**
 * The shared cookie domain applies only when the request host sits under it, so localhost and
 * *.vercel.app previews keep host-only cookies even if the env var is set.
 */
export function sharedCookieDomain(
  configured: string | null | undefined,
  host: string | null | undefined,
): string | null {
  const domain = (configured ?? '').trim().toLowerCase()
  if (!domain.startsWith('.') || domain.length < 4) return null
  const name = hostname(host)
  const bare = domain.slice(1)
  return name === bare || name.endsWith(domain) ? domain : null
}

export function authCookieOptions(
  configured: string | null | undefined,
  host: string | null | undefined,
): AuthCookieOptions | undefined {
  const domain = sharedCookieDomain(configured, host)
  if (!domain) return undefined
  return { domain, path: '/', sameSite: 'lax', secure: true }
}

export function isAuthCookie(name: string): boolean {
  return name.startsWith('sb-')
}

export function serializeCookie(
  name: string,
  value: string,
  opts: { domain?: string; maxAge: number; httpOnly?: boolean; secure?: boolean },
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/']
  if (opts.domain) parts.push(`Domain=${opts.domain}`)
  parts.push(`Max-Age=${opts.maxAge}`, 'SameSite=Lax')
  if (opts.secure) parts.push('Secure')
  if (opts.httpOnly) parts.push('HttpOnly')
  return parts.join('; ')
}

export function expireCookie(name: string, domain?: string): string {
  return serializeCookie(name, '', { domain, maxAge: 0, secure: Boolean(domain) })
}

/**
 * Non-httpOnly hint that a session exists, so cached anonymous pages know to fetch the viewer's
 * own state in the browser. It is never trusted for access: the API still checks the session.
 */
export const AUTH_HINT_COOKIE = 'rs_auth'

export function authHintCookie(domain: string | null | undefined): string {
  return serializeCookie(AUTH_HINT_COOKIE, '1', {
    domain: domain ?? undefined,
    maxAge: AUTH_COOKIE_MAX_AGE,
    secure: Boolean(domain),
  })
}

/** Set-Cookie values that clear the hint on the shared domain and any host-only copy. */
export function clearAuthHintCookies(domain: string | null | undefined): string[] {
  const host = expireCookie(AUTH_HINT_COOKIE)
  return domain ? [host, expireCookie(AUTH_HINT_COOKIE, domain)] : [host]
}

export function hasAuthHint(cookieHeader: string | null | undefined): boolean {
  return (cookieHeader ?? '').split(/;\s*/).some((c) => c === `${AUTH_HINT_COOKIE}=1`)
}
