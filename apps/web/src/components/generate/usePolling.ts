'use client'

import { useEffect, useRef } from 'react'

/** Calls tick every intervalMs while enabled, pausing while the tab is hidden. */
export function usePolling(tick: () => void | Promise<void>, enabled: boolean, intervalMs = 4000) {
  const latest = useRef(tick)
  useEffect(() => {
    latest.current = tick
  })
  useEffect(() => {
    if (!enabled) return
    let timer: ReturnType<typeof setInterval> | undefined
    const start = () => {
      if (timer) return
      timer = setInterval(() => void latest.current(), intervalMs)
    }
    const stop = () => {
      clearInterval(timer)
      timer = undefined
    }
    const onVisibility = () => {
      if (document.hidden) stop()
      else {
        void latest.current()
        start()
      }
    }
    if (!document.hidden) start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [enabled, intervalMs])
}
