'use client'

import { useEffect, useRef } from 'react'

const HUMAN_EVENTS = ['pointerdown', 'touchstart', 'wheel', 'keydown'] as const

/** Flips to true on the first trusted touch, click, wheel or key press anywhere on the page. */
export function useHumanInput(): React.RefObject<boolean> {
  const seen = useRef(false)
  useEffect(() => {
    const opts = { capture: true, passive: true } as const
    const mark = (e: Event) => {
      if (!e.isTrusted) return
      seen.current = true
      for (const name of HUMAN_EVENTS) window.removeEventListener(name, mark, opts)
    }
    for (const name of HUMAN_EVENTS) window.addEventListener(name, mark, opts)
    return () => {
      for (const name of HUMAN_EVENTS) window.removeEventListener(name, mark, opts)
    }
  }, [])
  return seen
}
