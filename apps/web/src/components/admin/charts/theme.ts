import type { MetricKey } from '@/lib/admin/stats'

export const CHART_COLORS = {
  accent: '#c8f751',
  info: '#6cb6ff',
  violet: '#b4a0ff',
  ok: '#5fdc9a',
  warn: '#f5b84b',
  orange: '#ff7a29',
  danger: '#ff6b6b',
  faint: '#71717a',
  grid: 'rgba(255, 255, 255, 0.06)',
  cursor: 'rgba(255, 255, 255, 0.28)',
  hoverBar: 'rgba(255, 255, 255, 0.04)',
} as const

export const METRIC_COLORS: Record<MetricKey, string> = {
  newUsers: CHART_COLORS.accent,
  activeUsers: CHART_COLORS.info,
  views: CHART_COLORS.violet,
  interactions: CHART_COLORS.ok,
  asks: CHART_COLORS.orange,
  rendered: CHART_COLORS.accent,
  requests: CHART_COLORS.info,
  spend: CHART_COLORS.warn,
}

export const CHART_MOTION = { durationMs: 600, easing: 'ease-out' } as const
export const MAIN_CHART_HEIGHT = 280
export const SECONDARY_CHART_HEIGHT = 200
export const AXIS_TICK = { fill: CHART_COLORS.faint, fontSize: 11 }
