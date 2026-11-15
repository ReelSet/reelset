'use client'

import { useState } from 'react'
import { METRICS, type MetricKey, type RangeDays } from '@/lib/admin/stats'
import type { OverviewStats } from '@/server/admin/stats'
import { ChartCard } from './ChartCard'
import { ComparisonBarChart } from './ComparisonBarChart'
import { EngagementChart } from './EngagementChart'
import { KpiCard } from './KpiCard'
import { MainChartCard } from './MainChartCard'
import { CHART_COLORS, METRIC_COLORS } from './theme'

type Props = { stats: OverviewStats; range: RangeDays }

const DEFAULT_METRIC: MetricKey = 'newUsers'
const PIPELINE_SERIES = [
  { key: 'rendered', label: 'Rendered', color: CHART_COLORS.accent },
  { key: 'requested', label: 'Requested', color: CHART_COLORS.info },
]

function cardHint(key: MetricKey, stats: OverviewStats): string | undefined {
  if (key === 'newUsers') return `${stats.totalUsers.toLocaleString('en-US')} total`
  if (key === 'activeUsers') return 'distinct, signed in'
  return undefined
}

/** KPI row, main chart for the selected KPI, and two secondary charts; all data comes from the server. */
export function OverviewDashboard({ stats, range }: Props) {
  const [selected, setSelected] = useState<MetricKey>(DEFAULT_METRIC)
  const meta = METRICS.find((m) => m.key === selected) ?? METRICS[0]!
  const { metrics } = stats

  const pipelineData = metrics.rendered.points.map((p, i) => ({
    day: p.day,
    rendered: p.value,
    requested: metrics.requests.points[i]?.value ?? 0,
  }))
  const engagementData = metrics.views.points.map((p, i) => ({
    day: p.day,
    views: p.value,
    interactions: metrics.interactions.points[i]?.value ?? 0,
  }))

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {METRICS.map((m) => (
          <KpiCard
            key={m.key}
            meta={m}
            series={metrics[m.key]}
            color={METRIC_COLORS[m.key]}
            selected={m.key === selected}
            unavailable={stats.unavailable.includes(m.key)}
            hint={cardHint(m.key, stats)}
            onSelect={() => setSelected(m.key)}
          />
        ))}
      </div>
      <MainChartCard
        meta={meta}
        series={metrics[selected]}
        color={METRIC_COLORS[selected]}
        range={range}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Reels rendered vs requested" legend={PIPELINE_SERIES}>
          <ComparisonBarChart data={pipelineData} series={PIPELINE_SERIES} />
        </ChartCard>
        <ChartCard
          title="Engagement"
          legend={[
            { label: 'Views', color: CHART_COLORS.violet },
            { label: 'Likes + saves', color: CHART_COLORS.ok },
          ]}
        >
          <EngagementChart data={engagementData} />
        </ChartCard>
      </div>
    </div>
  )
}
