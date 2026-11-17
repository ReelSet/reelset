'use client'

import {
  Bar,
  BarChart,
  Cell,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts'
import { formatCompact, formatMetricValue } from '@/lib/admin/stats'
import type { HourSlice } from '@/lib/instagram/insights'
import { TooltipCard } from './TooltipCard'
import { AXIS_TICK, CHART_COLORS, CHART_MOTION, SECONDARY_CHART_HEIGHT } from './theme'
import { useReducedMotion } from './useReducedMotion'

const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? 'a' : 'p'}`

function HoverCard({ active, payload }: TooltipContentProps) {
  const slice = payload?.[0]?.payload as HourSlice | undefined
  if (!active || !slice) return null
  return (
    <TooltipCard
      title={`${hourLabel(slice.hour)} hour`}
      rows={[
        {
          label: 'Avg views',
          value: formatMetricValue(slice.avgViews, 'count'),
          color: CHART_COLORS.violet,
        },
        { label: 'Posts', value: String(slice.posts), color: CHART_COLORS.faint, muted: true },
      ]}
    />
  )
}

/** Average views by the hour a reel went out; the best hour is lit, hours with no posts stay empty. */
export function HourChart({ data }: { data: HourSlice[] }) {
  const reducedMotion = useReducedMotion()
  const best = Math.max(...data.map((d) => d.avgViews))
  return (
    <div style={{ height: SECONDARY_CHART_HEIGHT }}>
      <ResponsiveContainer width="100%" height={SECONDARY_CHART_HEIGHT}>
        <BarChart data={data} margin={{ top: 8, right: 0, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke={CHART_COLORS.grid} />
          <XAxis
            dataKey="hour"
            tickFormatter={hourLabel}
            interval={2}
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
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
            content={HoverCard}
          />
          <Bar
            dataKey="avgViews"
            radius={[3, 3, 0, 0]}
            maxBarSize={14}
            isAnimationActive={!reducedMotion}
            animationDuration={CHART_MOTION.durationMs}
            animationEasing={CHART_MOTION.easing}
          >
            {data.map((d) => (
              <Cell
                key={d.hour}
                fill={best > 0 && d.avgViews === best ? CHART_COLORS.accent : CHART_COLORS.violet}
                fillOpacity={d.posts === 0 ? 0 : 0.85}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
