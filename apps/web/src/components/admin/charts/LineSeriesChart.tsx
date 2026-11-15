'use client'

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts'
import { formatDayKey } from '@/lib/admin/stats'
import { formatInZone } from '@/lib/time/zone'
import { TooltipCard } from './TooltipCard'
import { AXIS_TICK, CHART_COLORS, CHART_MOTION, SECONDARY_CHART_HEIGHT } from './theme'
import { useReducedMotion } from './useReducedMotion'

export type LineSeries = { key: string; label: string; color: string }
export type LineDatum = { x: string } & Record<string, number | string | null>
export type LineReference = { value: number; label: string }

type Props = {
  data: LineDatum[]
  series: LineSeries[]
  xKind: 'day' | 'hour'
  tz: string
  valueSuffix: string
  yMax: number
  reference?: LineReference
}

type CardProps = Pick<Props, 'series' | 'xKind' | 'tz' | 'valueSuffix'>

const formatValue = (value: number, suffix: string) =>
  `${Number.isInteger(value) ? value : value.toFixed(1)}${suffix}`

const formatX = (x: string, kind: 'day' | 'hour', tz: string) =>
  kind === 'day' ? formatDayKey(x) : formatInZone(x, tz)

function HoverCard({
  active,
  payload,
  series,
  xKind,
  tz,
  valueSuffix,
}: TooltipContentProps & CardProps) {
  const datum = payload?.[0]?.payload as LineDatum | undefined
  if (!active || !datum) return null
  const rows = series.flatMap((s) => {
    const value = datum[s.key]
    if (typeof value !== 'number') return []
    return [{ label: s.label, value: formatValue(value, valueSuffix), color: s.color }]
  })
  if (rows.length === 0) return null
  return <TooltipCard title={formatX(datum.x, xKind, tz)} rows={rows} />
}

/** Multi-series line chart over days or hours; null values leave gaps instead of drawing zero. */
export function LineSeriesChart({ data, series, xKind, tz, valueSuffix, yMax, reference }: Props) {
  const reducedMotion = useReducedMotion()
  return (
    <div style={{ height: SECONDARY_CHART_HEIGHT }}>
      <ResponsiveContainer width="100%" height={SECONDARY_CHART_HEIGHT}>
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke={CHART_COLORS.grid} />
          <XAxis
            dataKey="x"
            tickFormatter={(x: string) => formatX(x, xKind, tz)}
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            minTickGap={48}
            tickMargin={8}
          />
          <YAxis
            width={40}
            domain={[0, yMax]}
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            allowDecimals={false}
            tickFormatter={(v: number) => `${v}${valueSuffix}`}
          />
          <Tooltip
            cursor={{ stroke: CHART_COLORS.cursor, strokeDasharray: '3 3' }}
            animationDuration={150}
            content={(p: TooltipContentProps) => (
              <HoverCard {...p} series={series} xKind={xKind} tz={tz} valueSuffix={valueSuffix} />
            )}
          />
          {reference && (
            <ReferenceLine
              y={reference.value}
              stroke={CHART_COLORS.danger}
              strokeDasharray="4 3"
              label={{
                value: reference.label,
                position: 'insideTopLeft',
                fill: CHART_COLORS.danger,
                fontSize: 10,
              }}
            />
          )}
          {series.map((s) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              stroke={s.color}
              strokeWidth={2}
              dot={false}
              connectNulls={false}
              isAnimationActive={!reducedMotion}
              animationDuration={CHART_MOTION.durationMs}
              animationEasing={CHART_MOTION.easing}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
