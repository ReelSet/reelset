import { loadGateConfig } from '@reelset/core'
import Link from 'next/link'
import { GateFilterBar } from '@/components/admin/gate/GateFilterBar'
import { GateKeyboard } from '@/components/admin/gate/GateKeyboard'
import { GateModeBanner } from '@/components/admin/gate/GateModeBanner'
import { GateOverview } from '@/components/admin/gate/GateOverview'
import { BulkAgreeBar, GateTable } from '@/components/admin/gate/GateTable'
import { SortBar, sortQuery, type SortColumn, type SortCtx } from '@/components/admin/sortable'
import { Empty, Flash, Pager, Toolbar } from '@/components/admin/ui'
import {
  DEFAULT_GATE_RANGE,
  DEFAULT_GATE_SORT,
  GATE_PAGE_SIZE,
  GATE_RANGE_DAYS,
  GATE_SORT_KEYS,
  gateFilterParams,
  gateRangeParam,
  parseGateFilters,
  parseGateRange,
  type GateRangeDays,
  type GateSortKey,
} from '@/lib/admin/gate'
import { GATE_TABLE_MISSING } from '@/lib/admin/gate-view'
import { ADMIN_ROUTES } from '@/lib/admin/nav'
import { pageHref, parsePage } from '@/lib/admin/pagination'
import { parseSort } from '@/lib/admin/sort'
import { zoneHint } from '@/lib/time/zone'
import { loadGateQueue } from '@/server/admin/gate-queries'
import { assertAdmin } from '@/server/admin/guard'
import { getDb } from '@/server/db'
import { routeLog } from '@/server/logger'
import { viewerTimeZone } from '@/server/timezone'

export const metadata = { title: 'Gate' }

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }
type Params = Record<string, string | undefined>

const COLUMNS: SortColumn<GateSortKey>[] = [
  { key: 'score', label: 'Score' },
  { key: 'decided', label: 'Age' },
]

function RangeSwitch({ active, params }: { active: GateRangeDays; params: Params }) {
  return (
    <nav
      aria-label="Date range"
      className="inline-flex rounded-md border border-line bg-surface p-0.5"
    >
      {GATE_RANGE_DAYS.map((days) => {
        const range = days === DEFAULT_GATE_RANGE ? undefined : gateRangeParam(days)
        return (
          <Link
            key={days}
            href={pageHref(ADMIN_ROUTES.gate, { ...params, range }, 1)}
            replace
            scroll={false}
            aria-current={days === active ? 'page' : undefined}
            className={`rounded px-3 py-1 text-xs tabular-nums transition ${
              days === active ? 'bg-raised text-fg' : 'text-muted hover:text-fg'
            }`}
          >
            {gateRangeParam(days)}
          </Link>
        )
      })}
    </nav>
  )
}

export default async function GatePage({ searchParams }: Props) {
  await assertAdmin()
  const tz = await viewerTimeZone()
  const sp = await searchParams
  const page = parsePage(sp.page, GATE_PAGE_SIZE)
  const filters = parseGateFilters(sp)
  const rangeDays = parseGateRange(sp.range)
  const sort = parseSort(sp, GATE_SORT_KEYS, DEFAULT_GATE_SORT)
  const db = getDb()
  const log = routeLog('admin/gate')
  const [config, queue] = await Promise.all([
    loadGateConfig(db, log),
    loadGateQueue(db, log, { page, filters, sort, rangeDays, tz }),
  ])

  const filterParams: Params = {
    ...gateFilterParams(filters),
    range: rangeDays === DEFAULT_GATE_RANGE ? undefined : gateRangeParam(rangeDays),
  }
  const sortCtx: SortCtx<GateSortKey> = {
    path: ADMIN_ROUTES.gate,
    params: filterParams,
    sort,
    fallback: DEFAULT_GATE_SORT,
    columns: COLUMNS,
  }
  const params = { ...filterParams, ...sortQuery(sortCtx) }
  const returnTo = pageHref(ADMIN_ROUTES.gate, params, page.page)
  const rows = queue?.rows ?? []
  const rowsKey = rows.map((row) => `${row.gate.decisionId}:${row.gate.label ?? ''}`).join(',')

  return (
    <div>
      <Flash value={sp.flash} />
      <GateModeBanner mode={config.mode} migrated={queue !== null} />
      <Toolbar
        hint={`Every decision the gate has made. Agree or disagree so the judge learns from your labels. ${zoneHint(tz)}`}
        actions={
          <div className="flex items-center gap-2">
            <GateKeyboard rowsKey={rowsKey} />
            <RangeSwitch active={rangeDays} params={params} />
          </div>
        }
      />
      {queue ? <GateOverview overview={queue.overview} tz={tz} /> : null}
      <GateFilterBar filters={filters} params={params} counts={queue?.overview.counts ?? null} />
      {!queue ? (
        <Empty>{GATE_TABLE_MISSING}</Empty>
      ) : rows.length === 0 ? (
        <Empty>
          {filters.review === 'pending' && queue.overview.counts.pending === 0
            ? 'Nothing left to review. Every decision has a label.'
            : 'No decisions match these filters'}
        </Empty>
      ) : (
        <>
          <SortBar ctx={sortCtx} />
          <BulkAgreeBar returnTo={returnTo} count={rows.length} />
          <GateTable
            rows={rows}
            outcomes={queue.outcomes}
            sortCtx={sortCtx}
            ctx={{ tz, now: new Date(), returnTo }}
          />
        </>
      )}
      <Pager
        path={ADMIN_ROUTES.gate}
        params={params}
        page={page.page}
        hasMore={queue?.hasMore ?? false}
      />
    </div>
  )
}
