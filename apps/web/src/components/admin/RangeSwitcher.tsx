import Link from 'next/link'
import { RANGE_OPTIONS, rangeParam, type RangeDays } from '@/lib/admin/stats'

/** Segmented 7d / 30d / 90d control; each segment is a link so the range lives in the URL. */
export function RangeSwitcher({ active, basePath }: { active: RangeDays; basePath: string }) {
  return (
    <nav
      aria-label="Date range"
      className="inline-flex rounded-md border border-line bg-surface p-0.5"
    >
      {RANGE_OPTIONS.map((days) => (
        <Link
          key={days}
          href={`${basePath}?range=${rangeParam(days)}`}
          replace
          scroll={false}
          aria-current={days === active ? 'page' : undefined}
          className={`rounded px-3 py-1 text-xs tabular-nums transition ${
            days === active ? 'bg-raised text-fg' : 'text-muted hover:text-fg'
          }`}
        >
          {rangeParam(days)}
        </Link>
      ))}
    </nav>
  )
}
