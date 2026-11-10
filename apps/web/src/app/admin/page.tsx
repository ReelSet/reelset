import { Source } from '@reelset/core'
import { z } from 'zod'
import { pageHref, parsePage } from '@/lib/admin/pagination'
import { filtersToParams, parseRecentFilters } from '@/lib/admin/recent-filters'
import { Empty, Flash, Pager, Section } from '@/components/admin/ui'
import { AutoRefresh } from '@/components/admin/pipeline/AutoRefresh'
import { HealthStrip } from '@/components/admin/pipeline/HealthStrip'
import { InProgressRow, RecentRow } from '@/components/admin/pipeline/ItemRow'
import { ItemDrawer } from '@/components/admin/pipeline/ItemDrawer'
import { RecentFilterBar } from '@/components/admin/pipeline/RecentFilterBar'
import { SOURCES } from '@/components/ui/sources'
import { assertAdmin } from '@/server/admin/guard'
import { livePostPermalink } from '@/server/admin/instagram'
import {
  IN_PROGRESS_LIMIT,
  healthSnapshot,
  inProgressItems,
  itemDetail,
  recentItems,
  stageMedians,
} from '@/server/admin/pipeline-queries'
import { mediaBaseUrl } from '@/server/env'
import { getDb } from '@/server/db'
import { log } from '@/server/logger'

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }

const PATH = '/admin'
const RECENT_PAGE_SIZE = 20
const KNOWN_SOURCES = [...Object.keys(SOURCES), ...Object.values(Source)]

export default async function PipelinePage({ searchParams }: Props) {
  await assertAdmin()
  const sp = await searchParams
  const db = getDb()
  const now = new Date()
  const filters = parseRecentFilters(sp, KNOWN_SOURCES)
  const page = parsePage(sp.page, RECENT_PAGE_SIZE)
  const itemParam = z.guid().safeParse(Array.isArray(sp.item) ? sp.item[0] : sp.item)
  const listParams = filtersToParams(filters)

  const [health, progress, medians, recent, detail] = await Promise.all([
    healthSnapshot(db, log),
    inProgressItems(db),
    stageMedians(db),
    recentItems(db, filters, page),
    itemParam.success ? itemDetail(db, itemParam.data) : Promise.resolve(null),
  ])
  const permalink = detail ? await livePostPermalink(db, detail.item.id) : null

  const hrefFor = (extra: Record<string, string | undefined>) =>
    pageHref(PATH, { ...listParams, ...extra }, page.page)
  const closeHref = hrefFor({})
  const detailHref = (id: string) => hrefFor({ item: id })
  const returnTo = detail ? detailHref(detail.item.id) : closeHref

  return (
    <div>
      <Flash value={sp.flash} />
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Pipeline</h1>
          <p className="mt-1 text-[13px] text-faint">
            What is running, what is stuck, and what just finished.
          </p>
        </div>
        <AutoRefresh renderedAt={now.toISOString()} />
      </div>

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

      {detail ? (
        <ItemDrawer
          detail={detail}
          closeHref={closeHref}
          returnTo={returnTo}
          mediaBase={mediaBaseUrl()}
          instagramHref={`/admin/instagram?item=${detail.item.id}`}
          postedPermalink={permalink}
          now={now}
        />
      ) : null}
    </div>
  )
}
