'use client'

import { useEffect, useState } from 'react'
import { relativeTime, shortDuration } from '@/lib/admin/pipeline'

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

export function absoluteTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' })
}

// Live-ticking duration since an instant, for "time in this step".
export function Elapsed({ since }: { since: string }) {
  const now = useNow(1000)
  return (
    <time dateTime={since} title={`Since ${absoluteTime(since)}`} className="tabular-nums">
      {shortDuration(now - new Date(since).getTime())}
    </time>
  )
}

export function Ago({ at }: { at: string | null }) {
  const now = useNow(5000)
  if (!at) return <span>-</span>
  return (
    <time dateTime={at} title={absoluteTime(at)} className="tabular-nums">
      {relativeTime(at, new Date(now))}
    </time>
  )
}
