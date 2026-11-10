'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { CloseIcon } from '@/components/ui/icons'

export function DrawerShell({
  closeHref,
  title,
  children,
}: {
  closeHref: string
  title: string
  children: React.ReactNode
}) {
  const router = useRouter()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) =>
      e.key === 'Escape' && router.push(closeHref, { scroll: false })
    document.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [closeHref, router])
  return (
    <div
      className="fixed inset-0 z-40 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <Link
        href={closeHref}
        scroll={false}
        aria-label="Close details"
        className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
      />
      <aside className="animate-fade-in relative flex h-full w-full max-w-[34rem] flex-col border-l border-line-strong bg-surface shadow-[-12px_0_32px_rgb(0_0_0/0.35)]">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <p className="text-[11px] uppercase tracking-wider text-faint">Item details</p>
          <Link
            href={closeHref}
            scroll={false}
            className="rounded p-1.5 text-muted transition hover:bg-raised hover:text-fg"
            aria-label="Close"
          >
            <CloseIcon className="h-4 w-4" />
          </Link>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
          {children}
        </div>
      </aside>
    </div>
  )
}
