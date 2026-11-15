import { Source } from '@reelset/core'
import { ADMIN_ROUTES } from '@/lib/admin/nav'
import { pageHref, parsePage } from '@/lib/admin/pagination'
import { filtersToParams, parseRecentFilters } from '@/lib/admin/recent-filters'
import { Empty, Flash, Pager, Section, Toolbar } from '@/components/admin/ui'
import { AutoRefresh } from '@/components/admin/pipeline/AutoRefresh'
import { HealthStrip } from '@/components/admin/pipeline/HealthStrip'
import { InProgressRow, RecentRow } from '@/components/admin/pipeline/ItemRow'
import { RecentFilterBar } from '@/components/admin/pipeline/RecentFilterBar'
import { SOURCES } from '@/components/ui/sources'
import { assertAdmin } from '@/server/admin/guard'
import {
  IN_PROGRESS_LIMIT,
  healthSnapshot,
  inProgressItems,
  recentItems,
  stageMedians,
} from '@/server/admin/pipeline-queries'
import { getDb } from '@/server/db'
import { log } from '@/server/logger'

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }

const PATH = ADMIN_ROUTES.pipeline
const RECENT_PAGE_SIZE = 20
const KNOWN_SOURCES = [...Object.keys(SOURCES), ...Object.values(Source)]

export default async function PipelinePage({ searchParams }: Props) {
  await assertAdmin()
  const sp = await searchParams
  const db = getDb()
  const now = new Date()
  const filters = parseRecentFilters(sp, KNOWN_SOURCES)
  const page = parsePage(sp.page, RECENT_PAGE_SIZE)
  const listParams = filtersToParams(filters)

  const [health, progress, medians, recent] = await Promise.all([
    healthSnapshot(db, log),
    inProgressItems(db),
    stageMedians(db),
    recentItems(db, filters, page),
  ])

  const hrefFor = (extra: Record<string, string | undefined>) =>
    pageHref(PATH, { ...listParams, ...extra }, page.page)
  const returnTo = hrefFor({})
  const detailHref = (id: string) => hrefFor({ item: id })

  return (
    <div>
      <Flash value={sp.flash} />
      <Toolbar actions={<AutoRefresh renderedAt={now.toISOString()} />} />

      <HealthStrip health={health} now={now} />

      <Section
        title={`In progress · ${progress.length}${progress.length === IN_PROGRESS_LIMIT ? '+' : ''}`}
        aside={<span className="text-xs text-faint">Time is spent in the current step</span>}
      >
        {progress.length === 0 ? (
          <Empty>Nothing is being processed right now.</Empty>
        ) : (
          <ul className="overflow-hidden rounded-md border border-line bg-surface">
            {progress.map((item) => (
              <InProgressRow
                key={item.id}
                item={item}
                medians={medians}
                detailHref={detailHref(item.id)}
                now={now}
              />
            ))}
          </ul>
        )}
      </Section>

      <section id="recent" className="mb-9 scroll-mt-4">
        <h2 className="mb-3 text-[13px] font-medium text-muted">Recent</h2>
        <RecentFilterBar filters={filters} path={PATH} />
        {recent.rows.length === 0 ? (
          <Empty>No items match these filters.</Empty>
        ) : (
          <ul className="overflow-hidden rounded-md border border-line bg-surface">
            {recent.rows.map((item) => (
              <RecentRow
                key={item.id}
                item={item}
                detailHref={detailHref(item.id)}
                returnTo={returnTo}
                renderMs={item.render_ms}
              />
            ))}
          </ul>
        )}
        <Pager
          path={PATH}
          params={{ ...listParams, item: undefined }}
          page={page.page}
          hasMore={recent.hasMore}
        />
      </section>
    </div>
  )
}
