import { ChartCard } from '@/components/admin/charts/ChartCard'
import { LineSeriesChart } from '@/components/admin/charts/LineSeriesChart'
import { CHART_COLORS } from '@/components/admin/charts/theme'
import { Stat, Table, td, th } from '@/components/admin/ui'
import { SourceDot, sourceMeta } from '@/components/ui/sources'
import { fmtPct, fmtUsd } from '@/lib/admin/format'
import { share } from '@/lib/admin/gate'
import { VERDICT_LABELS } from '@/lib/admin/gate-view'
import type { GateOverview as Overview, GateSourceReview } from '@/server/admin/gate-queries'

const TREND_SERIES = [
  { key: 'reel', label: VERDICT_LABELS.reel, color: CHART_COLORS.ok },
  { key: 'source_only', label: VERDICT_LABELS.source_only, color: CHART_COLORS.faint },
]

function SourceTable({ sources }: { sources: GateSourceReview[] }) {
  return (
    <Table>
      <thead>
        <tr>
          <th className={th}>Source</th>
          <th className={th}>Decided</th>
          <th className={th}>Reel share</th>
          <th className={th}>Judge was right</th>
        </tr>
      </thead>
      <tbody>
        {sources.map((row) => (
          <tr key={row.source}>
            <td className={td}>
              <span className="inline-flex items-center gap-1.5">
                <SourceDot source={row.source} />
                {sourceMeta(row.source).label}
              </span>
            </td>
            <td className={`${td} tabular-nums`}>{row.decided}</td>
            <td className={`${td} tabular-nums`}>{fmtPct(share(row.reels, row.decided))}</td>
            <td className={`${td} tabular-nums`}>
              {fmtPct(share(row.judgeRight, row.labelled))}
              <span className="text-faint"> of {row.labelled}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  )
}

/** KPI tiles for the chosen range, then decisions per source and the daily reel versus source-only trend. */
export function GateOverview({ overview, tz }: { overview: Overview; tz: string }) {
  const { stats, counts, sources, trend } = overview
  const peak = Math.max(1, ...trend.map((point) => Math.max(point.reel, point.source_only)))
  return (
    <div className="mb-6 space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Decisions" value={stats.total.toLocaleString('en-US')} />
        <Stat label="Made into reels" value={fmtPct(share(stats.byVerdict.reel, stats.total))} />
        <Stat
          label="Held as source only"
          value={fmtPct(share(stats.byVerdict.source_only, stats.total))}
        />
        <Stat
          label="Awaiting review"
          value={counts.pending.toLocaleString('en-US')}
          tone={counts.pending > 0 ? 'warn' : undefined}
        />
        <Stat
          label={`Judge was right (${stats.labelled} labelled)`}
          value={fmtPct(stats.agreementRate)}
        />
        <Stat label="Gate spend" value={fmtUsd(stats.costUsd)} />
      </div>
      {stats.total > 0 ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <SourceTable sources={sources} />
          <ChartCard
            title="Decisions per day"
            legend={TREND_SERIES.map(({ label, color }) => ({ label, color }))}
          >
            <LineSeriesChart
              data={trend}
              series={TREND_SERIES}
              xKind="day"
              tz={tz}
              valueSuffix=""
              yMax={peak}
            />
          </ChartCard>
        </div>
      ) : null}
    </div>
  )
}
