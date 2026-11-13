export type CountRule = { show: boolean; min: number }

export type CountRules = { views: CountRule; likes: CountRule; saves: CountRule }

export const DEFAULT_COUNT_RULES: CountRules = {
  views: { show: false, min: 100 },
  likes: { show: true, min: 1 },
  saves: { show: false, min: 5 },
}

/** The count when the rule shows it and it reaches the threshold, otherwise null. */
export function visibleCount(count: number, rule: CountRule): number | null {
  if (!rule.show) return null
  if (!Number.isFinite(count) || count < 0) return null
  return count >= rule.min ? Math.floor(count) : null
}

const UNITS = [
  { at: 1_000_000_000, suffix: 'B' },
  { at: 1_000_000, suffix: 'M' },
  { at: 1_000, suffix: 'K' },
] as const

/** 999 -> "999", 1234 -> "1.2K", 12500 -> "12K", 1_500_000 -> "1.5M". */
export function formatCount(n: number): string {
  const value = Math.max(0, Math.floor(n))
  for (const [i, { at, suffix }] of UNITS.entries()) {
    if (value < at) continue
    const scaled = value / at
    const text =
      scaled < 10 ? (Math.floor(scaled * 10) / 10).toFixed(1) : String(Math.floor(scaled))
    if (text === '1000' && i > 0) return `1${UNITS[i - 1]?.suffix ?? ''}`
    return `${text.replace(/\.0$/, '')}${suffix}`
  }
  return String(value)
}
