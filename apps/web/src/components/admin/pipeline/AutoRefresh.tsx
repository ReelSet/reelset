'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, useTransition } from 'react'
import { AUTO_REFRESH_MS, shouldAutoRefresh } from '@/lib/admin/live-refresh'
import { shortDuration } from '@/lib/admin/pipeline'

const INPUT_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const

export function AutoRefresh({ renderedAt }: { renderedAt: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [paused, setPaused] = useState(false)
  const [idle, setIdle] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const lastInputAt = useRef(Date.now())

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(tick)
  }, [])

  useEffect(() => {
    if (paused) return
    const allowed = () =>
      shouldAutoRefresh({
        paused: false,
        hidden: document.visibilityState !== 'visible',
        lastInputAt: lastInputAt.current,
        now: Date.now(),
      })
    const refresh = () => {
      if (allowed()) startTransition(() => router.refresh())
      else setIdle(true)
    }
    // Coming back (input after idling, or the tab turning visible) refreshes once right away.
    const wake = () => {
      const wasIdle = !allowed()
      lastInputAt.current = Date.now()
      setIdle(false)
      if (wasIdle && document.visibilityState === 'visible') refresh()
    }
    const id = setInterval(refresh, AUTO_REFRESH_MS)
    for (const name of INPUT_EVENTS) window.addEventListener(name, wake, { passive: true })
    document.addEventListener('visibilitychange', wake)
    return () => {
      clearInterval(id)
      for (const name of INPUT_EVENTS) window.removeEventListener(name, wake)
      document.removeEventListener('visibilitychange', wake)
    }
  }, [paused, router])

  const age = Math.max(0, now - new Date(renderedAt).getTime())
  return (
    <div className="flex items-center gap-2 text-xs text-faint" aria-live="off">
      <span className="flex items-center gap-1.5">
        <span
          className={`h-1.5 w-1.5 rounded-full ${paused || idle ? 'bg-faint' : pending ? 'bg-info' : 'bg-ok'}`}
        />
        {paused
          ? 'Paused'
          : idle
            ? 'Idle, move to resume'
            : age < 3000
              ? 'Updated just now'
              : `Updated ${shortDuration(age)} ago`}
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
