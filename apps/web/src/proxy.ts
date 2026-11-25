import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import {
  AUTH_COOKIE_MAX_AGE,
  AUTH_DOMAIN_MARKER,
  AUTH_HINT_COOKIE,
  authCookieOptions,
  authHintCookie,
  clearAuthHintCookies,
  expireCookie,
  isAuthCookie,
  serializeCookie,
  sharedCookieDomain,
} from '@/lib/auth/cookie-options'
import { RETURN_PATH_HEADER } from '@/lib/auth/return-url'
import { routeForHost } from '@/lib/host-routing'
import { markdownRewritePath } from '@/lib/markdown-negotiation'
import { shouldRefresh } from '@/lib/auth/token-exp'
import { legacyReelRedirect, reelRewritePath } from '@/lib/reel-url'
import { agentLinkHeader } from '@/lib/seo/agent-links'
import { isUnknownSourcePath, sourceRewritePath } from '@/lib/source-path'

async function handle(request: NextRequest): Promise<NextResponse> {
  const route = routeForHost({
    host: request.headers.get('host'),
    pathname: request.nextUrl.pathname,
    adminHost: process.env.ADMIN_HOST ?? 'admin.reelset.app',
  })
  if (route.kind === 'not_found') {
    return new NextResponse('Not found', { status: 404 })
  }

  if (route.kind === 'redirect') {
    const target = request.nextUrl.clone()
    target.pathname = route.pathname
    return NextResponse.redirect(target)
  }

  let reelTarget: string | null = null
  if (route.kind === 'next') {
    const legacy = legacyReelRedirect(
      request.nextUrl.pathname,
      request.nextUrl.searchParams.get('reel'),
    )
    if (legacy) {
      const target = request.nextUrl.clone()
      target.pathname = legacy
      target.search = ''
      return NextResponse.redirect(target, 308)
    }
    const markdownPath = markdownRewritePath(
      request.nextUrl.pathname,
      request.headers.get('accept'),
    )
    if (markdownPath) {
      const target = request.nextUrl.clone()
      target.pathname = markdownPath
      target.search = ''
      return NextResponse.rewrite(target)
    }
    if (isUnknownSourcePath(request.nextUrl.pathname)) {
      return new NextResponse('Not found', { status: 404 })
    }
    const reel = reelRewritePath(request.nextUrl.pathname)
    if (reel?.kind === 'not_found') return new NextResponse('Not found', { status: 404 })
    if (request.nextUrl.pathname.includes('/opengraph-image')) {
      if (!reel) return NextResponse.next()
      const target = request.nextUrl.clone()
      target.pathname = reel.pathname
      return NextResponse.rewrite(target)
    }
    if (reel) reelTarget = reel.pathname
  }

  request.headers.set(RETURN_PATH_HEADER, request.nextUrl.pathname + request.nextUrl.search)
  let rewriteUrl: URL | null = null
  if (route.kind === 'rewrite') {
    rewriteUrl = request.nextUrl.clone()
    rewriteUrl.pathname = route.pathname
  } else if (reelTarget) {
    rewriteUrl = request.nextUrl.clone()
    rewriteUrl.pathname = reelTarget
  } else {
    const sourcePath = sourceRewritePath(
      request.nextUrl.pathname,
      request.nextUrl.searchParams.get('source'),
    )
    if (sourcePath) {
      rewriteUrl = request.nextUrl.clone()
      rewriteUrl.pathname = sourcePath
      rewriteUrl.searchParams.delete('source')
    }
  }
  const passOn = () =>
    rewriteUrl ? NextResponse.rewrite(rewriteUrl, { request }) : NextResponse.next({ request })

  let response = passOn()

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const authCookies = request.cookies.getAll().filter((c) => isAuthCookie(c.name))
  const host = request.headers.get('host')
  const domain = sharedCookieDomain(process.env.AUTH_COOKIE_DOMAIN, host)
  const refreshed = new Set<string>()

  const hinted = request.cookies.get(AUTH_HINT_COOKIE)?.value === '1'
  if (authCookies.length === 0) {
    if (hinted)
      for (const c of clearAuthHintCookies(domain)) response.headers.append('set-cookie', c)
    return response
  }

  if (url && anonKey && shouldRefresh(authCookies)) {
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
  }

  if (domain) {
    // Move sessions created before the shared domain existed: re-set host-only cookies on the
    // shared domain and expire the host-only copies, once per browser (marker cookie).
    if (request.cookies.get(AUTH_DOMAIN_MARKER)?.value !== '1') {
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
    } else if (refreshed.size > 0) {
      for (const name of refreshed) response.headers.append('set-cookie', expireCookie(name))
    }
  }
  if (!hinted) response.headers.append('set-cookie', authHintCookie(domain))
  return response
}

export async function proxy(request: NextRequest) {
  const response = await handle(request)
  if (response.status < 300) response.headers.set('link', agentLinkHeader(request.nextUrl.pathname))
  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|api/events|api/mcp|api/showcase|api/reel|api/avatar|api/views|api/feed|api/ask|favicon.ico|manifest.webmanifest|sitemap.xml|robots.txt|llms.txt|llms-full.txt|indexnow-key.txt|opengraph-image.*|apple-icon.png|icon-.*\\.png|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
