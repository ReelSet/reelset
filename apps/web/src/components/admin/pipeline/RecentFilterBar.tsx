import Link from 'next/link'
import { pageHref } from '@/lib/admin/pagination'
import {
  RANGES,
  STATUS_GROUPS,
  filtersToParams,
  type RangeKey,
  type RecentFilters,
  type StatusGroup,
} from '@/lib/admin/recent-filters'
import { SOURCES } from '@/components/ui/sources'
import { input } from '@/components/admin/ui'

function Pill({
  href,
  active,
  children,
}: {
  href: string
  active: boolean
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={active ? 'true' : undefined}
      className={`whitespace-nowrap rounded-full border px-2.5 py-1 text-xs transition ${
        active
          ? 'border-line-strong bg-raised text-fg'
          : 'border-line text-muted hover:bg-raised/60 hover:text-fg'
      }`}
    >
      {children}
    </Link>
  )
}

export function RecentFilterBar({ filters, path }: { filters: RecentFilters; path: string }) {
  const href = (patch: Partial<Record<'view' | 'source' | 'range', string | undefined>>) =>
    `${pageHref(path, { ...filtersToParams(filters), ...patch }, 1)}#recent`
  return (
    <div className="mb-3 space-y-2.5">
      <div className="no-scrollbar flex items-center gap-1.5 overflow-x-auto">
        {(Object.keys(STATUS_GROUPS) as StatusGroup[]).map((g) => (
          <Pill
            key={g}
            href={href({ view: g === 'all' ? undefined : g })}
            active={filters.group === g}
          >
            {STATUS_GROUPS[g].label}
          </Pill>
        ))}
        <span className="mx-1 h-4 w-px bg-line" />
        {(Object.keys(RANGES) as RangeKey[]).map((r) => (
          <Pill
            key={r}
            href={href({ range: r === '24h' ? undefined : r })}
            active={filters.range === r}
          >
            {RANGES[r].label}
          </Pill>
        ))}
      </div>
      <div className="no-scrollbar flex items-center gap-1.5 overflow-x-auto">
        <Pill href={href({ source: undefined })} active={!filters.source}>
          All sources
        </Pill>
        {Object.entries(SOURCES).map(([key, meta]) => (
          <Pill key={key} href={href({ source: key })} active={filters.source === key}>
            {meta.label}
          </Pill>
        ))}
      </div>
      <form method="get" action={`${path}#recent`} className="flex gap-2">
        {filters.group !== 'all' ? <input type="hidden" name="view" value={filters.group} /> : null}
        {filters.source ? <input type="hidden" name="source" value={filters.source} /> : null}
        {filters.range !== '24h' ? (
          <input type="hidden" name="range" value={filters.range} />
        ) : null}
        <input
          name="q"
          type="search"
          defaultValue={filters.q ?? ''}
          placeholder="Search titles"
          aria-label="Search titles"
          className={`${input} min-w-0 flex-1 sm:max-w-sm`}
        />
      </form>
    </div>
  )
}
