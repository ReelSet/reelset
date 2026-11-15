'use client'

import {
  CartesianGrid,
  Line,
  LineChart,
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

export type EngagementDatum = { day: string; views: number; interactions: number }

const VIEWS_COLOR = CHART_COLORS.violet
const INTERACTIONS_COLOR = CHART_COLORS.ok

function HoverCard({ active, payload }: TooltipContentProps) {
  const datum = payload?.[0]?.payload as EngagementDatum | undefined
  if (!active || !datum) return null
  const rate = datum.views > 0 ? `${((datum.interactions / datum.views) * 100).toFixed(1)}%` : '--'
  return (
    <TooltipCard
      title={formatDayKey(datum.day)}
      rows={[
        { label: 'Views', value: formatMetricValue(datum.views, 'count'), color: VIEWS_COLOR },
        {
          label: 'Likes + saves',
          value: formatMetricValue(datum.interactions, 'count'),
          color: INTERACTIONS_COLOR,
        },
        { label: 'Per view', value: rate, color: CHART_COLORS.faint, muted: true },
      ]}
    />
  )
}

function axisProps(color: string) {
  return {
    width: 40,
    tick: { ...AXIS_TICK, fill: color },
    tickLine: false,
    axisLine: false,
    allowDecimals: false,
    tickFormatter: (v: number) => formatCompact(v, 'count'),
  } as const
}

/** Views (left axis) against likes + saves (right axis); two scales keep the smaller series readable. */
export function EngagementChart({ data }: { data: EngagementDatum[] }) {
  const reducedMotion = useReducedMotion()
  const lineProps = {
    type: 'monotone',
    strokeWidth: 2,
    dot: false,
    isAnimationActive: !reducedMotion,
    animationDuration: CHART_MOTION.durationMs,
    animationEasing: CHART_MOTION.easing,
  } as const
  return (
    <div style={{ height: SECONDARY_CHART_HEIGHT }}>
      <ResponsiveContainer width="100%" height={SECONDARY_CHART_HEIGHT}>
        <LineChart data={data} margin={{ top: 8, right: 0, bottom: 0, left: 0 }}>
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
          <YAxis yAxisId="views" {...axisProps(VIEWS_COLOR)} />
          <YAxis yAxisId="interactions" orientation="right" {...axisProps(INTERACTIONS_COLOR)} />
          <Tooltip
            cursor={{ stroke: CHART_COLORS.cursor, strokeDasharray: '3 3' }}
            animationDuration={150}
            content={HoverCard}
          />
          <Line yAxisId="views" dataKey="views" stroke={VIEWS_COLOR} {...lineProps} />
          <Line
            yAxisId="interactions"
            dataKey="interactions"
            stroke={INTERACTIONS_COLOR}
            {...lineProps}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
