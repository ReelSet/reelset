export type Stat = {
  prefix: string
  value: number
  decimals: number
  suffix: string
  grouped: boolean
}

export function parseStat(raw: string): Stat | null {
  const match = /^(\D*?)(\d[\d,]*(?:\.\d+)?)(.*)$/.exec(raw.trim())
  if (!match) return null
  const [, prefix = '', digits = '', suffix = ''] = match
  const value = Number(digits.replace(/,/g, ''))
  if (!Number.isFinite(value)) return null
  const decimals = digits.includes('.') ? (digits.split('.')[1]?.length ?? 0) : 0
  return { prefix, value, decimals, suffix, grouped: digits.includes(',') }
}

export function formatStat(stat: Stat, progress: number): string {
  const current = stat.value * Math.min(1, Math.max(0, progress))
  const text = stat.grouped
    ? current.toLocaleString('en-US', {
        minimumFractionDigits: stat.decimals,
        maximumFractionDigits: stat.decimals,
      })
    : current.toFixed(stat.decimals)
  return `${stat.prefix}${text}${stat.suffix}`
}
