'use client'

import { formatMetricValue, type MetricMeta, type MetricSeries } from '@/lib/admin/stats'
import { DeltaChip } from './DeltaChip'
import { Sparkline } from './Sparkline'

type Props = {
  meta: MetricMeta
  series: MetricSeries
  color: string
  selected: boolean
  unavailable: boolean
  hint?: string
  onSelect: () => void
}

/** Clickable KPI tile: label, big total, delta chip and a sparkline; selecting it drives the main chart. */
export function KpiCard({ meta, series, color, selected, unavailable, hint, onSelect }: Props) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={`group flex flex-col rounded-md border bg-surface px-3.5 pb-2 pt-3 text-left transition duration-200 hover:bg-raised/60 focus-visible:outline-2 focus-visible:outline-accent ${
        selected ? 'border-line-strong bg-raised/50' : 'border-line'
      }`}
      style={selected ? { boxShadow: `inset 0 -2px 0 ${color}` } : undefined}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-faint">
          <span aria-hidden className="size-1.5 rounded-full" style={{ background: color }} />
          {meta.label}
        </span>
        {!unavailable && <DeltaChip pct={series.deltaPct} tone={meta.tone} />}
      </span>
      <span className="mt-1.5 text-2xl font-semibold tabular-nums tracking-tight">
        {unavailable ? '--' : formatMetricValue(series.total, meta.unit)}
      </span>
      <span className="mb-1 h-4 text-[11px] text-faint">
        {unavailable ? 'Failed to load' : hint}
      </span>
      <Sparkline points={series.points} color={color} />
    </button>
  )
}
