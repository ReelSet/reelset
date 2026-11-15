import { ADMIN_ROUTES } from '@/lib/admin/nav'
import { zoneLabel } from '@/lib/time/zone'
import { parseRange } from '@/lib/admin/stats'
import { AttentionStrip } from '@/components/admin/AttentionStrip'
import { OverviewDashboard } from '@/components/admin/charts/OverviewDashboard'
import { RangeSwitcher } from '@/components/admin/RangeSwitcher'
import { Toolbar } from '@/components/admin/ui'
import { assertAdmin } from '@/server/admin/guard'
import { overviewStats } from '@/server/admin/stats'
import { getDb } from '@/server/db'
import { routeLog } from '@/server/logger'
import { viewerTimeZone } from '@/server/timezone'

export const metadata = { title: 'Overview' }

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }

export default async function OverviewPage({ searchParams }: Props) {
  await assertAdmin()
  const range = parseRange((await searchParams).range)
  const tz = await viewerTimeZone()
  const stats = await overviewStats(getDb(), routeLog('admin/overview'), { days: range, tz })

  return (
    <div>
      <Toolbar
        hint={`Last ${range} days vs the ${range} before. Days in ${zoneLabel(tz)}; spend is by UTC day.`}
        actions={<RangeSwitcher active={range} basePath={ADMIN_ROUTES.overview} />}
      />
      <div className="mb-5">
        <AttentionStrip attention={stats.attention} />
      </div>
      <OverviewDashboard stats={stats} range={range} />
    </div>
  )
}
