import { NextResponse, type NextRequest } from 'next/server'
import { clearAuthHintCookies, sharedCookieDomain } from '@/lib/auth/cookie-options'
import { routeLog } from '@/server/logger'
import { createSupabaseResponseClient } from '@/server/supabase'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const log = routeLog('auth/logout')
  const { supabase, apply } = createSupabaseResponseClient(request)
  const { error } = await supabase.auth.signOut()
  if (error) log.warn({ errMessage: error.message }, 'sign out returned an error')
  else log.info('signed out')
  const response = apply(
    NextResponse.redirect(new URL('/', request.nextUrl.origin), { status: 303 }),
  )
  const domain = sharedCookieDomain(process.env.AUTH_COOKIE_DOMAIN, request.headers.get('host'))
  for (const header of clearAuthHintCookies(domain)) response.headers.append('set-cookie', header)
  return response
}
