import Link from 'next/link'
import { ADMIN_ROUTES } from '@/lib/admin/nav'
import type { Attention } from '@/server/admin/stats'

type Row = { key: keyof Attention; label: string; href: string }

const ROWS: Row[] = [
  { key: 'failedItems', label: 'failed items (24h)', href: ADMIN_ROUTES.pipeline },
  { key: 'failedInstagramPosts', label: 'failed Instagram posts', href: ADMIN_ROUTES.instagram },
  { key: 'openUpgradeRequests', label: 'credit upgrade requests', href: ADMIN_ROUTES.generate },
  {
    key: 'pendingFeedSubmissions',
    label: 'feed submissions to review',
    href: `${ADMIN_ROUTES.generate}#submissions`,
  },
  { key: 'openReelRequests', label: 'open reel requests', href: ADMIN_ROUTES.generate },
]

/** Only the queues that need a human, each linking to where they are handled; quiet when empty. */
export function AttentionStrip({ attention }: { attention: Attention }) {
  const active = ROWS.filter((r) => attention[r.key] > 0)
  if (active.length === 0) {
    return (
      <p className="flex items-center gap-2 text-[13px] text-muted">
        <span aria-hidden className="size-1.5 rounded-full bg-ok" />
        All clear. Nothing needs attention.
      </p>
    )
  }
  return (
    <ul className="flex flex-wrap gap-2" aria-label="Needs attention">
      {active.map((r) => (
        <li key={r.key}>
          <Link
            href={r.href}
            className="flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-1.5 text-[13px] text-muted transition hover:border-line-strong hover:text-fg"
          >
            <span className="rounded bg-warn/15 px-1.5 text-xs font-medium tabular-nums text-warn">
              {attention[r.key].toLocaleString('en-US')}
            </span>
            {r.label}
          </Link>
        </li>
      ))}
    </ul>
  )
}
