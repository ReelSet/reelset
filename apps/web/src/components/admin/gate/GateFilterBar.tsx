import { GATE_DECIDERS, GATE_TRIGGERS, GATE_VERDICTS, SOURCES } from '@reelset/core'
import Link from 'next/link'
import { Chips, button, buttonPrimary, input } from '@/components/admin/ui'
import { sourceMeta } from '@/components/ui/sources'
import {
  DEFAULT_GATE_REVIEW,
  GATE_REVIEW_FILTERS,
  GATE_REVIEW_LABELS,
  GATE_SEARCH_MAX_CHARS,
  type GateFilters,
} from '@/lib/admin/gate'
import { DECIDER_LABELS, TRIGGER_LABELS, VERDICT_LABELS } from '@/lib/admin/gate-view'
import { ADMIN_ROUTES } from '@/lib/admin/nav'
import { pageHref } from '@/lib/admin/pagination'
import type { GateReviewCounts } from '@/server/admin/gate-queries'

type Params = Record<string, string | undefined>

type Props = {
  filters: GateFilters
  params: Params
  counts: GateReviewCounts | null
}

function isFiltered(filters: GateFilters): boolean {
  return (
    filters.review !== DEFAULT_GATE_REVIEW ||
    !!(filters.verdict || filters.decidedBy || filters.source || filters.trigger || filters.q)
  )
}

/** Title search plus review, verdict, decided-by and source chips; every choice lives in the URL. */
export function GateFilterBar({ filters, params, counts }: Props) {
  const href = (patch: Params) => pageHref(ADMIN_ROUTES.gate, { ...params, ...patch }, 1)
  const { q: _q, ...carried } = params
  const count = (key: keyof GateReviewCounts) => (counts ? ` (${counts[key]})` : '')
  return (
    <div className="mb-5 flex flex-col gap-3">
      <form method="get" action={ADMIN_ROUTES.gate} className="flex flex-wrap gap-2">
        {Object.entries(carried).map(([name, value]) =>
          value ? <input key={name} type="hidden" name={name} value={value} /> : null,
        )}
        <input
          name="q"
          defaultValue={filters.q ?? ''}
          maxLength={GATE_SEARCH_MAX_CHARS}
          placeholder="Search titles"
          className={`${input} w-72 max-w-full`}
        />
        <button type="submit" className={buttonPrimary}>
          Search
        </button>
        {isFiltered(filters) ? (
          <Link href={ADMIN_ROUTES.gate} className={button}>
            Clear
          </Link>
        ) : null}
      </form>
      <Chips
        active={filters.review}
        items={GATE_REVIEW_FILTERS.map((review) => ({
          key: review,
          label: `${GATE_REVIEW_LABELS[review]}${count(review)}`,
          href: href({ review: review === DEFAULT_GATE_REVIEW ? undefined : review }),
        }))}
      />
      <Chips
        active={filters.verdict}
        items={[
          { key: 'all', label: 'Any verdict', href: href({ verdict: undefined }) },
          ...GATE_VERDICTS.map((verdict) => ({
            key: verdict,
            label: VERDICT_LABELS[verdict],
            href: href({ verdict }),
          })),
        ]}
      />
      <Chips
        active={filters.decidedBy}
        items={[
          { key: 'all', label: 'Decided by anyone', href: href({ by: undefined }) },
          ...GATE_DECIDERS.map((decider) => ({
            key: decider,
            label: DECIDER_LABELS[decider] ?? decider,
            href: href({ by: decider }),
          })),
        ]}
      />
      <Chips
        active={filters.trigger}
        items={[
          { key: 'all', label: 'Automatic and manual', href: href({ trigger: undefined }) },
          ...GATE_TRIGGERS.map((trigger) => ({
            key: trigger,
            label: TRIGGER_LABELS[trigger] ?? trigger,
            href: href({ trigger }),
          })),
        ]}
      />
      <Chips
        active={filters.source}
        items={[
          { key: 'all', label: 'All sources', href: href({ source: undefined }) },
          ...SOURCES.map((source) => ({
            key: source,
            label: sourceMeta(source).label,
            href: href({ source }),
          })),
        ]}
      />
    </div>
  )
}
