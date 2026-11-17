'use client'

import Link from 'next/link'
import { useState } from 'react'
import { ADMIN_ROUTES } from '@/lib/admin/nav'
import { formatMetricValue, type RangeDays } from '@/lib/admin/stats'
import { IG_METRICS, type IgMetricKey, type Insights } from '@/lib/instagram/insights'
import { ChartCard } from '../charts/ChartCard'
import { HourChart } from '../charts/HourChart'
import { KpiCard } from '../charts/KpiCard'
import { MainChartCard } from '../charts/MainChartCard'
import { CHART_COLORS } from '../charts/theme'
import { td, th } from '../primitives'

const COLORS: Record<IgMetricKey, string> = {
  views: CHART_COLORS.violet,
  reach: CHART_COLORS.info,
  engagement: CHART_COLORS.accent,
  posts: CHART_COLORS.orange,
  likes: CHART_COLORS.danger,
  comments: CHART_COLORS.warn,
  saves: CHART_COLORS.ok,
  shares: CHART_COLORS.info,
}

const SOURCE_NAMES: Record<string, string> = {
  hn: 'Hacker News',
  github: 'GitHub',
  news: 'News',
  reddit: 'Reddit',
  youtube: 'YouTube',
  papers: 'Papers',
  unknown: 'Other',
}

const pct = (v: number | null) => (v === null ? '--' : `${v.toFixed(1)}%`)

function Bar({ share, color }: { share: number; color: string }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
      <div
        className="h-full rounded-full transition-[width] duration-500"
        style={{ width: `${Math.max(share * 100, share > 0 ? 2 : 0)}%`, background: color }}
      />
    </div>
  )
}

function Funnel({ steps }: { steps: Insights['funnel'] }) {
  const top = Math.max(...steps.map((s) => s.value), 1)
  return (
    <ul className="space-y-3">
      {steps.map((s) => (
        <li key={s.key}>
          <div className="mb-1 flex items-baseline justify-between text-[13px]">
            <span className="text-muted">{s.label}</span>
            <span className="tabular-nums">
              {formatMetricValue(s.value, 'count')}
              {s.ofViews !== null && (
                <span className="ml-2 text-xs text-faint">{pct(s.ofViews)}</span>
              )}
            </span>
          </div>
          <Bar share={s.value / top} color={COLORS[s.key as IgMetricKey] ?? CHART_COLORS.violet} />
        </li>
      ))}
    </ul>
  )
}

function Sources({ slices }: { slices: Insights['bySource'] }) {
  const top = Math.max(...slices.map((s) => s.avgViews), 1)
  return (
    <ul className="space-y-3">
      {slices.map((s) => (
        <li key={s.source}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-[13px]">
            <span className="text-muted">
              {SOURCE_NAMES[s.source] ?? s.source}
              <span className="ml-2 text-xs text-faint">{s.posts} posts</span>
            </span>
            <span className="tabular-nums">
              {formatMetricValue(s.avgViews, 'count')}
              <span className="ml-2 text-xs text-faint">avg · {pct(s.rate)}</span>
            </span>
          </div>
          <Bar share={s.avgViews / top} color={CHART_COLORS.violet} />
        </li>
      ))}
    </ul>
  )
}

function TopReels({ reels }: { reels: Insights['topReels'] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr>
            <th className={th}>Reel</th>
            <th className={`${th} text-right`}>Views</th>
            <th className={`${th} text-right`}>Likes</th>
            <th className={`${th} text-right`}>Saves</th>
            <th className={`${th} text-right`}>Engagement</th>
            <th className={th} />
          </tr>
        </thead>
        <tbody>
          {reels.map((r) => (
            <tr key={r.id} className="[&:last-child>td]:border-b-0">
              <td className={`${td} max-w-[28ch] sm:max-w-[48ch]`}>
                <Link
                  href={`${ADMIN_ROUTES.pipeline}?item=${r.itemId}`}
                  className="line-clamp-1 hover:underline"
                >
                  {r.title}
                </Link>
                <span className="text-[11px] text-faint">{SOURCE_NAMES[r.source] ?? r.source}</span>
              </td>
              <td className={`${td} text-right tabular-nums`}>
                {formatMetricValue(r.views ?? 0, 'count')}
              </td>
              <td className={`${td} text-right tabular-nums`}>
                {formatMetricValue(r.likes ?? 0, 'count')}
              </td>
              <td className={`${td} text-right tabular-nums`}>
                {formatMetricValue(r.saves ?? 0, 'count')}
              </td>
              <td className={`${td} text-right tabular-nums`}>{pct(r.rate)}</td>
              <td className={`${td} text-right`}>
                {r.permalink ? (
                  <a
                    href={r.permalink}
                    target="_blank"
                    rel="noreferrer"
                    className="text-info hover:underline"
                  >
                    Open
                  </a>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const empty = (text: string) => (
  <p role="status" className="grid h-[120px] place-items-center text-[13px] text-faint">
    {text}
  </p>
)

/** KPI row, main chart for the selected KPI, then when-to-post, funnel, source and top-reel panels. */
export function InsightsDashboard({ insights, range }: { insights: Insights; range: RangeDays }) {
  const [selected, setSelected] = useState<IgMetricKey>('views')
  const meta = IG_METRICS.find((m) => m.key === selected) ?? IG_METRICS[0]!
  const { metrics } = insights
  const noNumbers = insights.syncedInRange === 0

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {IG_METRICS.map((m) => (
          <div key={m.key} className="flex flex-col [&>button]:flex-1">
            <KpiCard
              meta={m}
              series={metrics[m.key]}
              color={COLORS[m.key]}
              selected={m.key === selected}
              unavailable={false}
              onSelect={() => setSelected(m.key)}
            />
          </div>
        ))}
      </div>
      <MainChartCard
        meta={meta}
        series={metrics[selected]}
        color={COLORS[selected]}
        range={range}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Best time to post"
          legend={[{ label: 'Average views by hour', color: CHART_COLORS.violet }]}
        >
          {noNumbers ? (
            empty('No synced numbers in this range yet.')
          ) : (
            <HourChart data={insights.byHour} />
          )}
        </ChartCard>
        <ChartCard title="Where the views go">
          {noNumbers ? (
            empty('No synced numbers in this range yet.')
          ) : (
            <Funnel steps={insights.funnel} />
          )}
        </ChartCard>
        <ChartCard title="By source">
          {insights.bySource.length === 0 ? (
            empty('No posts yet.')
          ) : (
            <Sources slices={insights.bySource} />
          )}
        </ChartCard>
        <ChartCard title="Top reels">
          {insights.topReels.length === 0 ? (
            empty('No posts yet.')
          ) : (
            <TopReels reels={insights.topReels} />
          )}
        </ChartCard>
      </div>
    </div>
  )
}
