'use client'

import { useEffect } from 'react'
import { ChevronIcon } from '@/components/ui/icons'

const HINT_MS = 4500

/** One-time "swipe up" nudge; the caller remembers that it was shown. */
export function SwipeHint({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDone, HINT_MS)
    return () => clearTimeout(timer)
  }, [onDone])

  return (
    <div
      aria-hidden
      className="animate-fade-in pointer-events-none absolute inset-x-0 bottom-[calc(var(--bar,0px)+7rem)] z-30 flex flex-col items-center gap-1 text-white drop-shadow-[0_1px_4px_rgba(0,0,0,0.7)]"
    >
      <span className="flex animate-bounce flex-col items-center">
        <ChevronIcon dir="up" className="h-6 w-6" />
        <ChevronIcon dir="up" className="-mt-3 h-6 w-6 opacity-60" />
      </span>
      <span className="rounded-full bg-black/45 px-3 py-1 text-[12px] font-medium backdrop-blur-md">
        Swipe up for the next reel
      </span>
    </div>
  )
}
