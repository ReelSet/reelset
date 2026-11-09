import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import {
  AUTH_COOKIE_MAX_AGE,
  AUTH_DOMAIN_MARKER,
  authCookieOptions,
  expireCookie,
  isAuthCookie,
  serializeCookie,
  sharedCookieDomain,
} from '@/lib/auth/cookie-options'
import { RETURN_PATH_HEADER } from '@/lib/auth/return-url'
import { routeForHost } from '@/lib/host-routing'
import { SESSION_COOKIE, parseSessionId, sessionCookieOptions } from '@/lib/session'

const ADMIN_HOST = process.env.ADMIN_HOST ?? 'admin.reelset.app'

export async function proxy(request: NextRequest) {
  const route = routeForHost({
    host: request.headers.get('host'),
    pathname: request.nextUrl.pathname,
    adminHost: ADMIN_HOST,
  })
  if (route.kind === 'not_found') {
    return new NextResponse('Not found', { status: 404 })
  }

  if (route.kind === 'redirect') {
    const target = request.nextUrl.clone()
    target.pathname = route.pathname
    return NextResponse.redirect(target)
  }

  request.headers.set(RETURN_PATH_HEADER, request.nextUrl.pathname + request.nextUrl.search)
  const rewriteUrl = route.kind === 'rewrite' ? request.nextUrl.clone() : null
  if (rewriteUrl && route.kind === 'rewrite') rewriteUrl.pathname = route.pathname
  const passOn = () =>
    rewriteUrl ? NextResponse.rewrite(rewriteUrl, { request }) : NextResponse.next({ request })

  let response = passOn()

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const authCookies = request.cookies.getAll().filter((c) => isAuthCookie(c.name))
  const host = request.headers.get('host')
  const domain = sharedCookieDomain(process.env.AUTH_COOKIE_DOMAIN, host)
  const refreshed = new Set<string>()

  if (url && anonKey && authCookies.length > 0) {
    const supabase = createServerClient(url, anonKey, {
      cookieOptions: authCookieOptions(process.env.AUTH_COOKIE_DOMAIN, host),
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          for (const { name, value } of list) request.cookies.set(name, value)
          response = passOn()
          for (const { name, value, options } of list) {
            response.cookies.set(name, value, options)
            refreshed.add(name)
          }
        },
      },
    })
    await supabase.auth.getUser()

    // Move sessions created before the shared domain existed: re-set host-only cookies on the
    // shared domain and expire the host-only copies, once per browser (marker cookie).
    if (domain && request.cookies.get(AUTH_DOMAIN_MARKER)?.value !== '1') {
      for (const { name, value } of authCookies) {
        response.headers.append('set-cookie', expireCookie(name))
        if (refreshed.has(name)) continue
        const raw = request.cookies.get(name)?.value ?? value
        response.headers.append(
          'set-cookie',
          serializeCookie(name, raw, {
            domain,
            maxAge: AUTH_COOKIE_MAX_AGE,
            secure: true,
          }),
        )
      }
      response.headers.append(
        'set-cookie',
        serializeCookie(AUTH_DOMAIN_MARKER, '1', {
          domain,
          maxAge: AUTH_COOKIE_MAX_AGE,
          httpOnly: true,
          secure: true,
        }),
      )
    } else if (domain && refreshed.size > 0) {
      for (const name of refreshed) response.headers.append('set-cookie', expireCookie(name))
    }
  }

  if (!parseSessionId(request.cookies.get(SESSION_COOKIE)?.value)) {
    response.headers.append(
      'set-cookie',
      serializeCookie(SESSION_COOKIE, crypto.randomUUID(), {
        maxAge: sessionCookieOptions.maxAge,
        httpOnly: true,
        secure: sessionCookieOptions.secure,
      }),
    )
  }
  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|api/events|favicon.ico|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
