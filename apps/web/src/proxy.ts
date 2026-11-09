import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
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
  const hasAuthCookie = request.cookies.getAll().some((c) => c.name.startsWith('sb-'))

  if (url && anonKey && hasAuthCookie) {
    const supabase = createServerClient(url, anonKey, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          for (const { name, value } of list) request.cookies.set(name, value)
          response = passOn()
          for (const { name, value, options } of list) response.cookies.set(name, value, options)
        },
      },
    })
    await supabase.auth.getUser()
  }

  if (!parseSessionId(request.cookies.get(SESSION_COOKIE)?.value)) {
    response.cookies.set(SESSION_COOKIE, crypto.randomUUID(), sessionCookieOptions)
  }
  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|api/events|favicon.ico|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
