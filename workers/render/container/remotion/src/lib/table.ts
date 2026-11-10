import { sameNumber } from './text-rules'
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
  /** The highlighted cell; null for a plain table (no number said over it). */
  mark: { row: number; col: number } | null
}

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)
const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback

/** Label for the highlighted number: its row name and column header, both read from the table. */
export const cellLabel = (row: string | undefined, header: string | undefined): string =>
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
    value: props.plain ? '' : str(props.value) || rows[hi]![col] || '',
    label: props.plain ? '' : str(props.label) || cellLabel(rows[hi]?.[0], headers[col]),
    mark: props.plain ? null : { row: hi, col },
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
  TableScreen: { gap: 2.6, max: 4.0, keep: 3.6 },
  EquationScreen: { gap: 2.2, max: 4.0, keep: 3.4 },
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

const wordsOf = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length > 2),
  )

/**
 * The cell that holds a narrated number ("80.9" finds 80.93), preferring a column whose header
 * shares a word with the narrated label, then the highlighted row. Null when the table lacks it.
 */
export function matchCell(
  view: Pick<TableView, 'headers' | 'rows' | 'hi'>,
  narrated: string,
  label = '',
): { row: number; col: number } | null {
  const want = wordsOf(label)
  const hits: { row: number; col: number; score: number }[] = []
  view.rows.forEach((cells, r) =>
    cells.forEach((cell, c) => {
      if (c === 0 || !sameNumber(narrated, cell)) return
      const header = wordsOf(view.headers[c] ?? '')
      const shared = [...header].some((w) =>
        [...want].some((x) => x.startsWith(w) || w.startsWith(x)),
      )
      hits.push({ row: r, col: c, score: (shared ? 2 : 0) + (r === view.hi ? 1 : 0) })
    }),
  )
  const best = hits.sort((a, b) => b.score - a.score || a.row - b.row)[0]
  return best ? { row: best.row, col: best.col } : null
}
