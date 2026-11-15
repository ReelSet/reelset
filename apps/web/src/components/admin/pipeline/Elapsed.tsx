'use client'

import { useEffect, useState } from 'react'
import { relativeTime, shortDuration } from '@/lib/admin/pipeline'
import { formatInZone } from '@/lib/time/zone'
import { useTimeZone } from '@/components/ui/TimeZoneContext'

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

export function absoluteTime(iso: string, tz: string): string {
  return formatInZone(iso, tz, 'datetime-seconds')
}

// Live-ticking duration since an instant, for "time in this step".
export function Elapsed({ since }: { since: string }) {
  const now = useNow(1000)
  const tz = useTimeZone()
  return (
    <time dateTime={since} title={`Since ${absoluteTime(since, tz)}`} className="tabular-nums">
      {shortDuration(now - new Date(since).getTime())}
    </time>
  )
}

export function Ago({ at }: { at: string | null }) {
  const now = useNow(5000)
  const tz = useTimeZone()
  if (!at) return <span>-</span>
  return (
    <time dateTime={at} title={absoluteTime(at, tz)} className="tabular-nums">
      {relativeTime(at, new Date(now))}
    </time>
  )
}
