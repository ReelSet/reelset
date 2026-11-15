'use client'

import Link from 'next/link'
import { useSourceFilter } from '@/components/seo/FilterTransition'
import { SourceDot, sourceMeta } from '@/components/ui/sources'
import type { SourceChip } from '@/lib/seo/browse'

/** Source filter chips: real links for crawlers, instant in-page transitions for people. */
export function SourceFilter({ chips, sticky = true }: { chips: SourceChip[]; sticky?: boolean }) {
  const { activeSource, pending, select } = useSourceFilter()
  return (
    <nav
      aria-label="Filter by source"
      className={
        sticky
          ? 'sticky top-0 z-20 -mx-5 border-b border-line bg-bg/85 px-5 py-3 backdrop-blur-md'
          : ''
      }
    >
      <ul className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5">
        {chips.map((chip) => {
          const active = chip.source === activeSource
          return (
            <li key={chip.source ?? 'all'} className="shrink-0">
              <Link
                href={chip.href}
                scroll={false}
                onNavigate={(e) => {
                  e.preventDefault()
                  select(chip.href, chip.source)
                }}
                aria-current={active ? 'page' : undefined}
                className={`inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-full px-3.5 text-sm transition active:scale-95 ${
                  active
                    ? `bg-fg font-medium text-bg ${pending ? 'animate-pulse' : ''}`
                    : 'border border-line bg-raised text-muted hover:bg-hover hover:text-fg'
                }`}
              >
                {chip.source && <SourceDot source={chip.source} />}
                {chip.source ? sourceMeta(chip.source).label : 'All'}
                <span className="text-xs tabular-nums opacity-60">{chip.count}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
