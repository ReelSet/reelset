import Link from 'next/link'
import { AdminNav } from '@/components/admin/AdminNav'
import { Wordmark } from '@/components/ui/Logo'
import { assertAdmin } from '@/server/admin/guard'

export const dynamic = 'force-dynamic'
export const metadata = {
  title: { default: 'Admin', template: '%s | Reelset admin' },
  robots: { index: false, follow: false },
}

const LINKS = [
  { href: '/admin', label: 'Pipeline' },
  { href: '/admin/instagram', label: 'Instagram' },
  { href: '/admin/items', label: 'Items' },
  { href: '/admin/ingest', label: 'Ingest runs' },
  { href: '/admin/renders', label: 'Renders' },
  { href: '/admin/capacity', label: 'Capacity' },
  { href: '/admin/health', label: 'Source health' },
  { href: '/admin/spend', label: 'Spend' },
  { href: '/admin/ask', label: 'Ask log' },
  { href: '/admin/settings', label: 'Settings' },
]

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await assertAdmin()
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[14rem_minmax(0,1fr)]">
      <aside className="border-b border-line bg-surface/60 px-4 py-3 lg:sticky lg:top-0 lg:h-dvh lg:border-b-0 lg:border-r lg:py-5">
        <div className="mb-3 flex items-center justify-between lg:mb-6 lg:block">
          <Wordmark className="text-[15px]" />
          <span className="rounded border border-line px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-faint lg:mt-2 lg:inline-block">
            Admin
          </span>
        </div>
        <AdminNav links={LINKS} />
        <Link
          href="/"
          className="mt-6 hidden text-[13px] text-faint transition hover:text-fg lg:block"
        >
          Back to app
        </Link>
      </aside>
      <main className="animate-fade-in mx-auto w-full max-w-6xl min-w-0 px-4 py-6 text-[13px] lg:px-8 lg:py-8 [&_a:not([class])]:text-info [&_a:not([class]):hover]:underline">
        {children}
      </main>
    </div>
  )
}
