const MAX_DECIMALS = 3
const SIGNIFICANT_DIGITS = 3
const PROBABILITY_LABEL = /\b(?:probabilit\w*|chance|likelihood|confidence|prob)\b/i
const LONG_DECIMAL = /(\d[\d,]*)\.(\d{4,})/g

function roundDecimal(whole: string, fraction: string): string {
  const value = Number(`${whole.replace(/,/g, '')}.${fraction}`)
  const rounded =
    Math.abs(value) >= 0.1
      ? Number(value.toFixed(MAX_DECIMALS))
      : Number(value.toPrecision(SIGNIFICANT_DIGITS))
  const text = rounded.toLocaleString('en-US', {
    maximumFractionDigits: 20,
    useGrouping: whole.includes(','),
  })
  return text
}

/** Rounds decimals with 4+ fraction digits to 3 decimals (3 significant digits below 0.1), matching how grounding compares values. */
export function tidyDecimals(raw: string): string {
  return raw.replace(LONG_DECIMAL, (_m, whole: string, fraction: string) =>
    roundDecimal(whole, fraction),
  )
}

/** The text a stat screen shows: a bare 0-1 probability reads as a percent, any other long decimal is rounded. */
export function displayStat(raw: string, label = ''): string {
  const bare = /^\s*(0?\.\d+|1(?:\.0+)?|0)\s*$/.exec(raw)
  if (bare?.[1] && PROBABILITY_LABEL.test(label) && /\.\d{2,}/.test(raw)) {
    return `${Number((Number(bare[1]) * 100).toPrecision(SIGNIFICANT_DIGITS))}%`
  }
  return tidyDecimals(raw.trim())
}
