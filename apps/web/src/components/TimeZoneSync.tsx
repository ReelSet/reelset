'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { TZ_COOKIE } from '@/lib/time/zone'

const ONE_YEAR = 60 * 60 * 24 * 365

/** Stores the browser's time zone in a cookie so server-rendered times use it; refreshes once on change. */
export function TimeZoneSync() {
  const router = useRouter()
  useEffect(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (!zone) return
    const current = document.cookie
      .split('; ')
      .find((c) => c.startsWith(`${TZ_COOKIE}=`))
      ?.slice(TZ_COOKIE.length + 1)
    if (current && decodeURIComponent(current) === zone) return
    document.cookie = `${TZ_COOKIE}=${encodeURIComponent(zone)}; path=/; max-age=${ONE_YEAR}; samesite=lax`
    router.refresh()
  }, [router])
  return null
}
