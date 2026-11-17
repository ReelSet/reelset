import { ADMIN_ROUTES, INSTAGRAM_TABS } from '@/lib/admin/nav'
import { buildPeriods, parseRange } from '@/lib/admin/stats'
import { buildInsights } from '@/lib/instagram/insights'
import { zoneLabel } from '@/lib/time/zone'
import { AdminTabs } from '@/components/admin/AdminTabs'
import { RangeSwitcher } from '@/components/admin/RangeSwitcher'
import { InsightsDashboard } from '@/components/admin/instagram/InsightsDashboard'
import { PageHeader, Toolbar } from '@/components/admin/ui'
import { assertAdmin } from '@/server/admin/guard'
import { insightRows } from '@/server/admin/instagram'
import { getDb } from '@/server/db'
import { routeLog } from '@/server/logger'
import { viewerTimeZone } from '@/server/timezone'

export const metadata = { title: 'Instagram insights' }

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }

export default async function InstagramInsightsPage({ searchParams }: Props) {
  await assertAdmin()
  const range = parseRange((await searchParams).range)
  const tz = await viewerTimeZone()
  const now = new Date()
  const log = routeLog('admin/instagram/insights')
  const { prevDays } = buildPeriods(now, tz, range)
  const rows = await insightRows(getDb(), prevDays[0]!, tz)
  const insights = buildInsights(rows, { now, tz, days: range })
  log.info(
    { range, posts: rows.length, synced: insights.syncedInRange },
    'instagram insights built',
  )

  return (
    <div>
      <PageHeader
        title="Instagram"
        description="How the posted reels are doing, grouped by the day they went out."
      />
      <AdminTabs tabs={INSTAGRAM_TABS} label="Instagram sections" />
      <Toolbar
        hint={`Last ${range} days vs the ${range} before. Numbers are Instagram's latest per reel, so recent days keep growing. Days in ${zoneLabel(tz)}.`}
        actions={<RangeSwitcher active={range} basePath={ADMIN_ROUTES.instagramInsights} />}
      />
      <InsightsDashboard insights={insights} range={range} />
    </div>
  )
}
