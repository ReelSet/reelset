import { NextResponse, type NextRequest } from 'next/server'
import { routeLog } from '@/server/logger'
import { createSupabaseResponseClient } from '@/server/supabase'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const log = routeLog('auth/logout')
  const { supabase, apply } = createSupabaseResponseClient(request)
  const { error } = await supabase.auth.signOut()
  if (error) log.warn({ errMessage: error.message }, 'sign out returned an error')
  else log.info('signed out')
  return apply(NextResponse.redirect(new URL('/', request.nextUrl.origin), { status: 303 }))
}
