import type { ScreenName } from './types'

export type TableView = {
  ref: string
  caption: string
  headers: string[]
  rows: string[][]
  hi: number
  col: number
  best: Set<string>
  value: string
  label: string
}

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)
const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback

/** Label for the highlighted number: its row name and column header, both read from the table. */
const cellLabel = (row: string | undefined, header: string | undefined): string =>
  [row, header].filter((p): p is string => Boolean(p && p.trim())).join(' · ')

/** Shot props -> a table view, or null when there is nothing renderable (never throws). */
export function readTable(props: Record<string, unknown>): TableView | null {
  const headers = Array.isArray(props.headers) ? props.headers.map((h) => str(h)) : []
  const rawRows = Array.isArray(props.rows) ? props.rows : []
  const width = headers.length
  if (width < 2 || rawRows.length === 0) return null
  const rows = rawRows
    .map((r) => str(r).split('|'))
    .map((cells) =>
      Array.from({ length: width }, (_, i) => (cells[i] ?? '').replace(/\s*±.*$/, '').trim()),
    )
  const hi = Math.min(Math.max(0, Math.round(num(props.hi, rows.length - 1))), rows.length - 1)
  const col = Math.min(Math.max(1, Math.round(num(props.col, 1))), width - 1)
  const best = new Set(Array.isArray(props.best) ? props.best.map((b) => str(b)) : [])
  return {
    ref: str(props.ref, 'Table'),
    caption: str(props.caption),
    headers,
    rows,
    hi,
    col,
    best,
    value: str(props.value) || rows[hi]![col] || '',
    label: str(props.label) || cellLabel(rows[hi]?.[0], headers[col]),
  }
}

/** Column widths in px: the label column gets a third, the value columns share the rest. */
export function columnWidths(count: number, total: number): number[] {
  if (count <= 1) return [total]
  const label = Math.round(total * (count <= 2 ? 0.5 : count === 3 ? 0.4 : 0.34))
  const rest = Math.floor((total - label) / (count - 1))
  return [total - rest * (count - 1), ...Array.from({ length: count - 1 }, () => rest)]
}

/** Row height that fits `rows` + header into the free height, clamped to a readable range. */
export function rowHeight(available: number, rows: number, header = 96, chrome = 150): number {
  return Math.max(60, Math.min(124, Math.floor((available - chrome - header) / Math.max(1, rows))))
}

/** Long reads: how long a paper screen needs on screen before the next cut. Seconds. */
export const HOLDS: Partial<Record<ScreenName, { gap: number; max: number; keep: number }>> = {
  TableScreen: { gap: 2.6, max: 5.4, keep: 3.8 },
  EquationScreen: { gap: 2.2, max: 4.8, keep: 3.6 },
}

export const holdFor = (show: ScreenName) => HOLDS[show]

/** Font size that keeps a cell label on one line within `px`, never below `min`. */
export function fitLabel(
  text: string,
  px: number,
  max: number,
  min: number,
  charWidth = 0.56,
): number {
  const needed = text.length * charWidth * max
  return needed <= px ? max : Math.max(min, Math.floor(px / (text.length * charWidth)))
}

/** Drops markdown emphasis and code ticks the parser leaves in captions. */
export const plainText = (s: string): string =>
  s
    .replace(/\*\*?|__|`/g, '')
    .replace(/\s+/g, ' ')
    .trim()

/** Cuts at a word boundary so a clipped caption never ends mid-word. */
export function clipWords(s: string, n: number): string {
  if (s.length <= n) return s
  const cut = s.slice(0, n - 1)
  const at = cut.lastIndexOf(' ')
  return `${(at > n * 0.6 ? cut.slice(0, at) : cut).trimEnd()}…`
}
