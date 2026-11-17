'use client'

import { useState } from 'react'
import {
  formatMetricValue,
  type MetricDisplay,
  type MetricSeries,
  type RangeDays,
} from '@/lib/admin/stats'
import { ChartCard } from './ChartCard'
import { DeltaChip } from './DeltaChip'
import { MainAreaChart } from './MainAreaChart'
import { CHART_COLORS } from './theme'

type Props = { meta: MetricDisplay; series: MetricSeries; color: string; range: RangeDays }

function CompareToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onToggle}
      className={`rounded-md border px-2 py-1 text-xs transition ${
        on ? 'border-line-strong bg-raised text-fg' : 'border-line text-faint hover:text-muted'
      }`}
    >
      Compare to previous period
    </button>
  )
}

/** Main chart for the selected metric with its headline total and a previous-period comparison toggle. */
export function MainChartCard({ meta, series, color, range }: Props) {
  const [showPrevious, setShowPrevious] = useState(true)
  const empty = series.total === 0 && series.prevTotal === 0
  const legend = [
    { label: meta.label, color },
    ...(showPrevious
      ? [{ label: `Previous ${range} days`, color: CHART_COLORS.faint, dashed: true }]
      : []),
  ]
  return (
    <ChartCard
      title={
        <span className="flex items-baseline gap-2.5">
          <span>{meta.label}</span>
          <span className="text-lg font-semibold tabular-nums tracking-tight">
            {formatMetricValue(series.total, meta.unit)}
          </span>
          <DeltaChip pct={series.deltaPct} tone={meta.tone} />
        </span>
      }
      legend={legend}
      aside={<CompareToggle on={showPrevious} onToggle={() => setShowPrevious((v) => !v)} />}
    >
      {empty ? (
        <p role="status" className="grid h-[280px] place-items-center text-[13px] text-faint">
          No {meta.label.toLowerCase()} in this range yet.
        </p>
      ) : (
        <MainAreaChart
          points={series.points}
          unit={meta.unit}
          label={meta.label}
          color={color}
          showPrevious={showPrevious}
        />
      )}
    </ChartCard>
  )
}
