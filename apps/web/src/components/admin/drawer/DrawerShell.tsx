'use client'

import { useEffect, useRef } from 'react'
import { CloseIcon } from '@/components/ui/icons'

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,video[controls],[tabindex]:not([tabindex="-1"])'

function trapTab(event: KeyboardEvent, panel: HTMLElement) {
  const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.offsetParent !== null,
  )
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (!first || !last) {
    event.preventDefault()
    return
  }
  const active = document.activeElement
  if (event.shiftKey && (active === first || active === panel)) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && active === last) {
    event.preventDefault()
    first.focus()
  }
}

type Props = {
  label: string
  open: boolean
  onClose: () => void
  scrollKey: string
  children: React.ReactNode
}

/** Right-hand modal drawer: slides in on mount, slides out when open turns false, traps focus. */
export function DrawerShell({ label, open, onClose, scrollKey, children }: Props) {
  const panelRef = useRef<HTMLElement>(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    const panel = panelRef.current
    panel?.focus({ preventScroll: true })
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault()
        onCloseRef.current()
      } else if (event.key === 'Tab' && panel) trapTab(event, panel)
    }
    document.addEventListener('keydown', onKey)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
    }
  }, [])

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="presentation">
      <div
        aria-hidden
        onClick={onClose}
        className={`absolute inset-0 bg-black/60 backdrop-blur-[2px] ${open ? 'animate-fade-in' : 'animate-backdrop-out'}`}
      />
      <aside
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        data-state={open ? 'open' : 'closed'}
        className={`relative flex h-full w-full max-w-[34rem] flex-col border-l border-line-strong bg-surface shadow-[-12px_0_32px_rgb(0_0_0/0.35)] outline-none will-change-transform ${open ? 'animate-drawer-in' : 'animate-drawer-out'}`}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <p className="text-[11px] uppercase tracking-wider text-faint">{label}</p>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1.5 text-muted transition hover:bg-raised hover:text-fg"
            aria-label="Close"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>
        <div
          key={scrollKey}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4"
        >
          {children}
        </div>
      </aside>
    </div>
  )
}
