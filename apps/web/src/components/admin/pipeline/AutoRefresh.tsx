'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState, useTransition } from 'react'
import { shortDuration } from '@/lib/admin/pipeline'

export const REFRESH_INTERVAL_MS = 10_000

export function AutoRefresh({ renderedAt }: { renderedAt: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [paused, setPaused] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(tick)
  }, [])

  useEffect(() => {
    if (paused) return
    const refresh = () => {
      if (document.visibilityState === 'visible') startTransition(() => router.refresh())
    }
    const id = setInterval(refresh, REFRESH_INTERVAL_MS)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [paused, router])

  const age = Math.max(0, now - new Date(renderedAt).getTime())
  return (
    <div className="flex items-center gap-2 text-xs text-faint" aria-live="off">
      <span className="flex items-center gap-1.5">
        <span
          className={`h-1.5 w-1.5 rounded-full ${paused ? 'bg-faint' : pending ? 'bg-info' : 'bg-ok'}`}
        />
        {paused ? 'Paused' : age < 3000 ? 'Updated just now' : `Updated ${shortDuration(age)} ago`}
      </span>
      <button
        type="button"
        onClick={() => setPaused((p) => !p)}
        className="rounded border border-line px-1.5 py-0.5 transition hover:bg-raised hover:text-fg"
      >
        {paused ? 'Resume' : 'Pause'}
      </button>
      <button
        type="button"
        onClick={() => startTransition(() => router.refresh())}
        className="rounded border border-line px-1.5 py-0.5 transition hover:bg-raised hover:text-fg"
      >
        Refresh
      </button>
    </div>
  )
}
