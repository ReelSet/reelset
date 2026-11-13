'use client'

import { useEffect } from 'react'

type Props = {
  onNotInterested: () => void
  onShowFewer: () => void
  onClose: () => void
}

/** Action sheet behind a reel's "..." button. */
export function FeedbackMenu({ onNotInterested, onShowFewer, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const row =
    'flex min-h-12 w-full flex-col justify-center rounded-md bg-raised px-4 text-left transition hover:bg-hover active:scale-[0.99]'

  return (
    <div
      className="animate-fade-in absolute inset-0 z-50 flex flex-col justify-end bg-black/60"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Reel options"
        className="animate-sheet-up rounded-t-[28px] border-t border-line bg-surface px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-4 h-1 w-9 rounded-full bg-white/15" />
        <div className="flex flex-col gap-2">
          <button type="button" onClick={onNotInterested} className={row}>
            <span className="text-sm font-medium text-fg">Not interested</span>
            <span className="text-xs text-faint">Hide this reel from your feed</span>
          </button>
          <button type="button" onClick={onShowFewer} className={row}>
            <span className="text-sm font-medium text-fg">Show fewer like this</span>
            <span className="text-xs text-faint">Hide it and see less of its topics</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="mt-1 min-h-11 w-full rounded-md text-sm text-muted transition hover:text-fg"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
