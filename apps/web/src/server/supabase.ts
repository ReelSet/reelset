import { createServerClient } from '@supabase/ssr'
import { cookies, headers } from 'next/headers'
import type { NextRequest, NextResponse } from 'next/server'
import {
  AUTH_COOKIE_MAX_AGE,
  authCookieOptions,
  expireCookie,
  isAuthCookie,
  serializeCookie,
  sharedCookieDomain,
} from '@/lib/auth/cookie-options'

export async function createSupabaseServerClient() {
  const [store, h] = await Promise.all([cookies(), headers()])
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: authCookieOptions(process.env.AUTH_COOKIE_DOMAIN, h.get('host')),
      cookies: {
        getAll: () => store.getAll(),
        setAll: (list) => {
          try {
            for (const { name, value, options } of list) store.set(name, value, options)
          } catch {
            // Server Components cannot set cookies; proxy.ts refreshes the session instead.
          }
        },
      },
    },
  )
}

/**
 * For route handlers that return their own redirect: auth cookies are collected and written to
 * the response as raw Set-Cookie headers so the shared-domain cookie and the expiry of the legacy
 * host-only cookie of the same name can coexist.
 */
export function createSupabaseResponseClient(request: NextRequest) {
  const host = request.headers.get('host')
  const domain = sharedCookieDomain(process.env.AUTH_COOKIE_DOMAIN, host)
  const written = new Map<string, string>()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: authCookieOptions(process.env.AUTH_COOKIE_DOMAIN, host),
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          for (const { name, value, options } of list) {
            const maxAge = options.maxAge ?? AUTH_COOKIE_MAX_AGE
            written.set(
              name,
              serializeCookie(name, value, {
                domain: options.domain,
                maxAge,
                secure: Boolean(options.domain),
              }),
            )
          }
        },
      },
    },
  )
  function apply(response: NextResponse): NextResponse {
    const names = new Set([
      ...written.keys(),
      ...request.cookies
        .getAll()
        .map((c) => c.name)
        .filter(isAuthCookie),
    ])
    for (const name of names) {
      if (domain) response.headers.append('set-cookie', expireCookie(name))
      const header = written.get(name)
      if (header) response.headers.append('set-cookie', header)
      else if (domain) response.headers.append('set-cookie', expireCookie(name, domain))
    }
    return response
  }
  return { supabase, apply }
}
