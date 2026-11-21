'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { TZ_COOKIE } from '@/lib/time/zone'

const ONE_YEAR = 60 * 60 * 24 * 365

// Only these sections (and the admin host, which serves /admin at its root) render times from
// the cookie on the server; public pages use LocalTime.
const SERVER_ZONED = ['/admin', '/profile', '/create']

/**
 * Stores the browser's time zone in a cookie so server-rendered times use it. On a section that
 * reads it, a change refreshes once; elsewhere a refresh would only re-render cached pages.
 */
export function TimeZoneSync() {
  const router = useRouter()
  const pathname = usePathname()
  useEffect(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (!zone) return
    const current = document.cookie
      .split('; ')
      .find((c) => c.startsWith(`${TZ_COOKIE}=`))
      ?.slice(TZ_COOKIE.length + 1)
    if (current && decodeURIComponent(current) === zone) return
    document.cookie = `${TZ_COOKIE}=${encodeURIComponent(zone)}; path=/; max-age=${ONE_YEAR}; samesite=lax`
    const zoned =
      window.location.hostname.startsWith('admin.') ||
      SERVER_ZONED.some((p) => pathname === p || pathname.startsWith(`${p}/`))
    if (zoned) router.refresh()
  }, [router, pathname])
  return null
}
