'use client'

import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts'
import { formatCompact, formatDayKey, formatMetricValue, type MetricUnit } from '@/lib/admin/stats'
import { TooltipCard } from './TooltipCard'
import { AXIS_TICK, CHART_COLORS, CHART_MOTION, SECONDARY_CHART_HEIGHT } from './theme'
import { useReducedMotion } from './useReducedMotion'

export type BarSeries = { key: string; label: string; color: string }
export type BarDatum = { day: string } & Record<string, number | string>

export type BarReferenceLine = { value: number; label: string; color: string }

type Props = {
  data: BarDatum[]
  series: BarSeries[]
  unit?: MetricUnit
  stacked?: boolean
  referenceLine?: BarReferenceLine
}

type CardProps = { series: BarSeries[]; unit: MetricUnit; stacked: boolean }

function HoverCard({ active, payload, series, unit, stacked }: TooltipContentProps & CardProps) {
  const datum = payload?.[0]?.payload as BarDatum | undefined
  if (!active || !datum) return null
  const values = series.map((s) => ({ s, value: Number(datum[s.key] ?? 0) }))
  const rows = values
    .filter(({ value }) => !stacked || value > 0)
    .map(({ s, value }) => ({
      label: s.label,
      value: formatMetricValue(value, unit),
      color: s.color,
    }))
  if (stacked) {
    const total = values.reduce((sum, { value }) => sum + value, 0)
    rows.push({
      label: 'Total',
      value: formatMetricValue(total, unit),
      color: CHART_COLORS.faint,
    })
  }
  return <TooltipCard title={formatDayKey(datum.day)} rows={rows} />
}

/** Daily bars, grouped or stacked per series, with an optional guide line and a dark hover tooltip. */
export function ComparisonBarChart({
  data,
  series,
  unit = 'count',
  stacked = false,
  referenceLine,
}: Props) {
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
            allowDecimals={unit === 'usd'}
            tickFormatter={(v: number) => formatCompact(v, unit)}
          />
          <Tooltip
            cursor={{ fill: CHART_COLORS.hoverBar }}
            animationDuration={150}
            content={(p: TooltipContentProps) => (
              <HoverCard {...p} series={series} unit={unit} stacked={stacked} />
            )}
          />
          {referenceLine && (
            <ReferenceLine
              y={referenceLine.value}
              ifOverflow="extendDomain"
              stroke={referenceLine.color}
              strokeDasharray="4 3"
              label={{
                value: referenceLine.label,
                position: 'insideTopLeft',
                fill: referenceLine.color,
                fontSize: 10,
              }}
            />
          )}
          {series.map((s) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              fill={s.color}
              stackId={stacked ? 'stack' : undefined}
              radius={stacked ? 0 : [3, 3, 0, 0]}
              maxBarSize={stacked ? 28 : 14}
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
