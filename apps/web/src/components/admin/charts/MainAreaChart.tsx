'use client'

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts'
import {
  formatCompact,
  formatDayKey,
  formatMetricValue,
  type MetricUnit,
  type SeriesPoint,
} from '@/lib/admin/stats'
import { TooltipCard } from './TooltipCard'
import { AXIS_TICK, CHART_COLORS, CHART_MOTION, MAIN_CHART_HEIGHT } from './theme'
import { useGradientId } from './useGradientId'
import { useReducedMotion } from './useReducedMotion'

type Props = {
  points: SeriesPoint[]
  unit: MetricUnit
  label: string
  color: string
  showPrevious: boolean
}

type TooltipProps = Pick<Props, 'unit' | 'label' | 'color' | 'showPrevious'> & TooltipContentProps

function HoverCard({ active, payload, unit, label, color, showPrevious }: TooltipProps) {
  const point = payload?.[0]?.payload as SeriesPoint | undefined
  if (!active || !point) return null
  const rows = [{ label, value: formatMetricValue(point.value, unit), color }]
  if (showPrevious) {
    rows.push({
      label: formatDayKey(point.prevDay),
      value: formatMetricValue(point.prev, unit),
      color: CHART_COLORS.faint,
    })
  }
  return <TooltipCard title={formatDayKey(point.day)} rows={rows} />
}

/** Gradient area chart with hover crosshair, dark tooltip and an optional dashed previous-period line. */
export function MainAreaChart({ points, unit, label, color, showPrevious }: Props) {
  const gradientId = useGradientId('main')
  const reducedMotion = useReducedMotion()
  const animate = !reducedMotion
  return (
    <div style={{ height: MAIN_CHART_HEIGHT }}>
      <ResponsiveContainer width="100%" height={MAIN_CHART_HEIGHT}>
        <ComposedChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.32} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
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
            width={44}
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            allowDecimals={unit === 'usd'}
            tickFormatter={(v: number) => formatCompact(v, unit)}
          />
          <Tooltip
            cursor={{ stroke: CHART_COLORS.cursor, strokeDasharray: '3 3' }}
            animationDuration={150}
            content={(p: TooltipContentProps) => (
              <HoverCard
                {...p}
                unit={unit}
                label={label}
                color={color}
                showPrevious={showPrevious}
              />
            )}
          />
          {showPrevious && (
            <Line
              dataKey="prev"
              type="monotone"
              stroke={CHART_COLORS.faint}
              strokeWidth={1.5}
              strokeDasharray="4 4"
              dot={false}
              activeDot={false}
              isAnimationActive={animate}
              animationDuration={CHART_MOTION.durationMs}
            />
          )}
          <Area
            dataKey="value"
            type="monotone"
            stroke={color}
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            dot={false}
            activeDot={{ r: 4, stroke: CHART_COLORS.cursor, strokeWidth: 1, fill: color }}
            isAnimationActive={animate}
            animationDuration={CHART_MOTION.durationMs}
            animationEasing={CHART_MOTION.easing}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
