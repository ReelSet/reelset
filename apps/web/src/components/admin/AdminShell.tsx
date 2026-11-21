import { Suspense } from 'react'
import { appHref } from '@/lib/admin/app-url'
import { Wordmark } from '@/components/ui/Logo'
import { AdminNav } from './AdminNav'
import { AdminNavWithBadges } from './AdminNavWithBadges'

function BadgedNav({ variant }: { variant: 'sidebar' | 'bottom' }) {
  return (
    <Suspense fallback={<AdminNav variant={variant} badges={{}} />}>
      <AdminNavWithBadges variant={variant} />
    </Suspense>
  )
}

const BACK_LINK = 'text-[13px] text-faint transition hover:text-fg'

/** Sidebar on desktop, compact top bar plus bottom tab bar on mobile. */
export function AdminShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[14rem_minmax(0,1fr)]">
      <header className="flex items-center justify-between border-b border-line bg-surface/60 px-4 py-3 lg:hidden">
        <Wordmark className="text-[15px]" />
        <a href={appHref('/')} className={BACK_LINK}>
          Back to app
        </a>
      </header>
      <aside className="hidden flex-col border-r border-line bg-surface/60 px-3 py-5 lg:sticky lg:top-0 lg:flex lg:h-dvh">
        <div className="mb-8 px-2.5">
          <Wordmark className="text-[15px]" />
          <span className="mt-2 inline-block rounded border border-line px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-faint">
            Admin
          </span>
        </div>
        <BadgedNav variant="sidebar" />
        <a href={appHref('/')} className={`${BACK_LINK} mt-auto px-2.5`}>
          Back to app
        </a>
      </aside>
      <main className="animate-fade-in mx-auto w-full max-w-6xl min-w-0 px-4 py-6 pb-24 text-[13px] lg:px-8 lg:py-8 lg:pb-8 [&_a:not([class])]:text-info [&_a:not([class]):hover]:underline">
        {children}
      </main>
      <BadgedNav variant="bottom" />
    </div>
  )
}
