'use client'

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts'
import { formatCompact, formatDayKey, formatMetricValue } from '@/lib/admin/stats'
import { TooltipCard } from './TooltipCard'
import { AXIS_TICK, CHART_COLORS, CHART_MOTION, SECONDARY_CHART_HEIGHT } from './theme'
import { useReducedMotion } from './useReducedMotion'

export type BarSeries = { key: string; label: string; color: string }
export type BarDatum = { day: string } & Record<string, number | string>

type Props = { data: BarDatum[]; series: BarSeries[] }

function HoverCard({ active, payload, series }: TooltipContentProps & { series: BarSeries[] }) {
  const datum = payload?.[0]?.payload as BarDatum | undefined
  if (!active || !datum) return null
  const rows = series.map((s) => ({
    label: s.label,
    value: formatMetricValue(Number(datum[s.key] ?? 0), 'count'),
    color: s.color,
  }))
  return <TooltipCard title={formatDayKey(datum.day)} rows={rows} />
}

/** Grouped daily bars, one bar per series, with a dark hover tooltip. */
export function ComparisonBarChart({ data, series }: Props) {
  const reducedMotion = useReducedMotion()
  return (
    <div style={{ height: SECONDARY_CHART_HEIGHT }}>
      <ResponsiveContainer width="100%" height={SECONDARY_CHART_HEIGHT}>
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barGap={2}>
          <CartesianGrid vertical={false} stroke={CHART_COLORS.grid} />
          <XAxis
            dataKey="day"
            tickFormatter={formatDayKey}
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            minTickGap={36}
            tickMargin={8}
          />
          <YAxis
            width={40}
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            allowDecimals={false}
            tickFormatter={(v: number) => formatCompact(v, 'count')}
          />
          <Tooltip
            cursor={{ fill: CHART_COLORS.hoverBar }}
            animationDuration={150}
            content={(p: TooltipContentProps) => <HoverCard {...p} series={series} />}
          />
          {series.map((s) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              fill={s.color}
              radius={[3, 3, 0, 0]}
              maxBarSize={14}
              isAnimationActive={!reducedMotion}
              animationDuration={CHART_MOTION.durationMs}
              animationEasing={CHART_MOTION.easing}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
