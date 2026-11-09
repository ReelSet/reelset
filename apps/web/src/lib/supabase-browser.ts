import { createBrowserClient } from '@supabase/ssr'
import { authCookieOptions } from '@/lib/auth/cookie-options'

export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: authCookieOptions(
        process.env.NEXT_PUBLIC_AUTH_COOKIE_DOMAIN,
        window.location.host,
      ),
    },
  )
}
