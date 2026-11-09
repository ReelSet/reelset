import { errorFields } from '@reelset/core'
import { NextResponse, type NextRequest } from 'next/server'
import { safeReturnPath } from '@/lib/auth/return-url'
import { ensureProfile } from '@/server/auth'
import { routeLog } from '@/server/logger'
import { createSupabaseResponseClient } from '@/server/supabase'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const log = routeLog('auth/callback')
  const { searchParams, origin } = request.nextUrl
  const next = safeReturnPath(searchParams.get('next'))
  const code = searchParams.get('code')
  const tokenHash = searchParams.get('token_hash')

  const { supabase, apply } = createSupabaseResponseClient(request)
  try {
    const result = code
      ? await supabase.auth.exchangeCodeForSession(code)
      : tokenHash
        ? await supabase.auth.verifyOtp({ type: 'email', token_hash: tokenHash })
        : null

    const user = result?.data.user
    if (!result || result.error || !user) {
      log.warn(
        { method: code ? 'code' : tokenHash ? 'token_hash' : 'none' },
        'auth callback rejected',
      )
      return NextResponse.redirect(`${origin}/login?error=callback`)
    }
    await ensureProfile(user.id)
    log.info({ profileId: user.id }, 'login completed')
    return apply(NextResponse.redirect(`${origin}${next}`))
  } catch (err) {
    log.error(errorFields(err), 'auth callback failed')
    return NextResponse.redirect(`${origin}/login?error=callback`)
  }
}
