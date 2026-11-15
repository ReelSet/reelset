'use client'

import { Area, AreaChart, ResponsiveContainer } from 'recharts'
import type { SeriesPoint } from '@/lib/admin/stats'
import { useGradientId } from './useGradientId'

const HEIGHT = 36

/** Tiny axis-less area chart for KPI cards; static so a row of them stays cheap. */
export function Sparkline({ points, color }: { points: SeriesPoint[]; color: string }) {
  const gradientId = useGradientId('spark')
  return (
    <div aria-hidden style={{ height: HEIGHT }}>
      <ResponsiveContainer width="100%" height={HEIGHT}>
        <AreaChart data={points} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            dataKey="value"
            type="monotone"
            stroke={color}
            strokeWidth={1.5}
            fill={`url(#${gradientId})`}
            isAnimationActive={false}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
