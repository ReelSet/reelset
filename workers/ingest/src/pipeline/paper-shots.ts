import {
  findFigure,
  findTable,
  isNumericCell,
  mainResultsTable,
  type ItemImage,
  type PaperTable,
  type ParsedPaper,
} from '@reelset/core'

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

export const MAX_TABLE_ROWS = 6
export const MAX_TABLE_VALUE_COLS = 3
const OURS = /\b(?:ours?|proposed|this work)\b/i
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s)
const cell = (s: string) => clip(s.replace(/\|/g, '/').replace(/\s+/g, ' ').trim(), 40)

function numericColumns(t: PaperTable): number[] {
  return t.headers
    .map((_, c) => c)
    .filter((c) => {
      const cells = t.rows.map((r) => r[c] ?? '').filter((x) => x.trim() !== '')
      return cells.length >= 2 && cells.filter(isNumericCell).length / cells.length >= 0.5
    })
}

/** The last text column before the first numeric one: "Method" in [Input, Method, ...scores]. */
function labelColumn(t: PaperTable, numeric: readonly number[]): number {
  const first = numeric[0] ?? 1
  return Math.max(0, first - 1)
}

export type TableHint = { row?: string; metric?: string }

/**
 * A phone-sized slice of a results table: the 3 most relevant value columns, up to 6 rows with the
 * highlighted (best or "ours") row among them. Props are flat strings and numbers so the container
 * validator accepts them.
 */
export function buildTableProps(t: PaperTable, hint: TableHint = {}): Obj | null {
  const numeric = numericColumns(t)
  if (numeric.length === 0 || t.rows.length < 2) return null
  const labelCol = labelColumn(t, numeric)
  const bestAt = (r: number, c: number) => t.best.some(([br, bc]) => br === r && bc === c)
  const bestCount = (c: number) => t.rows.filter((_, r) => bestAt(r, c)).length

  const metric = hint.metric?.toLowerCase().trim()
  const chosen = [...numeric]
    .sort((a, b) => {
      const ma = metric && t.headers[a]!.toLowerCase().includes(metric) ? 1 : 0
      const mb = metric && t.headers[b]!.toLowerCase().includes(metric) ? 1 : 0
      return mb - ma || bestCount(b) - bestCount(a) || a - b
    })
    .slice(0, MAX_TABLE_VALUE_COLS)
    .sort((a, b) => a - b)

  const hasValue = (r: number) => chosen.some((c) => isNumericCell(t.rows[r]?.[c] ?? ''))
  const eligible = t.rows.map((_, r) => r).filter(hasValue)
  if (eligible.length < 2) return null

  const wanted = hint.row?.toLowerCase().trim()
  const byHint = wanted
    ? eligible.find((r) => (t.rows[r]![labelCol] ?? '').toLowerCase().includes(wanted))
    : undefined
  const bestScore = (r: number) => chosen.filter((c) => bestAt(r, c)).length
  const byBest = [...eligible].sort((a, b) => bestScore(b) - bestScore(a) || b - a)[0]
  const byOurs = [...eligible].reverse().find((r) => OURS.test(t.rows[r]![labelCol] ?? ''))
  const hi =
    byHint ?? (bestScore(byBest!) > 0 ? byBest! : (byOurs ?? eligible[eligible.length - 1]!))

  const priority = [hi, ...eligible.filter((r) => r !== hi && bestScore(r) > 0), ...eligible]
  const picked = [...new Set(priority)].slice(0, MAX_TABLE_ROWS).sort((a, b) => a - b)

  const headers = [t.headers[labelCol] ?? '', ...chosen.map((c) => t.headers[c] ?? '')].map((h) =>
    cell(h),
  )
  const rows = picked.map((r) => [
    t.rows[r]![labelCol] ?? '',
    ...chosen.map((c) => t.rows[r]![c] ?? ''),
  ])
  const hiRow = picked.indexOf(hi)
  const bestCells = picked.flatMap((r, ri) =>
    chosen.flatMap((c, ci) => (bestAt(r, c) ? [`${ri}:${ci + 1}`] : [])),
  )
  const keyCol = Math.max(
    1,
    chosen.findIndex((c) => bestAt(hi, c)) + 1 ||
      (metric ? chosen.findIndex((c) => t.headers[c]!.toLowerCase().includes(metric)) + 1 : 0) ||
      1,
  )
  const props: Obj = {
    ref: t.label ?? 'Table',
    caption: clip(t.caption.replace(/\s+/g, ' '), 150),
    headers,
    rows: rows.map((r) => r.map(cell).join('|')),
    hi: hiRow,
    col: keyCol,
    value: rows[hiRow]![keyCol] ?? '',
    label: headers[keyCol] ?? '',
  }
  if (bestCells.length > 0) props.best = bestCells.slice(0, 8)
  return props
}

type Shot = Obj & { show?: unknown; props?: unknown }
type ScriptLike = { beats?: unknown }

function eachShot(script: ScriptLike): Shot[] {
  if (!Array.isArray(script.beats)) return []
  return script.beats.flatMap((b) =>
    isObj(b) && Array.isArray(b.shots) ? b.shots.filter(isObj) : [],
  )
}

const PAPER_ONLY = new Set(['TableScreen', 'EquationScreen'])

export type ResolveStats = { tables: number; equations: number; figures: number; dropped: number }

/**
 * Turns the model's references (table "Table 2", equation "(3)", figure "Figure 1") into the props
 * the renderer needs. Shots whose reference cannot be resolved are removed; paper-only screens are
 * removed entirely when there is no parsed paper.
 */
export function resolvePaperShots(
  script: ScriptLike,
  paper: ParsedPaper | null,
  images: readonly ItemImage[],
): ResolveStats {
  const stats: ResolveStats = { tables: 0, equations: 0, figures: 0, dropped: 0 }
  if (!Array.isArray(script.beats)) return stats
  for (const beat of script.beats) {
    if (!isObj(beat) || !Array.isArray(beat.shots)) continue
    const kept: unknown[] = []
    for (const raw of beat.shots as unknown[]) {
      if (!isObj(raw)) continue
      const shot = raw as Shot
      const props = isObj(shot.props) ? shot.props : {}
      if (typeof shot.show === 'string' && PAPER_ONLY.has(shot.show) && !paper) {
        stats.dropped++
        continue
      }
      if (shot.show === 'TableScreen' && paper) {
        const table =
          (props.table !== undefined ? findTable(paper, props.table) : undefined) ??
          mainResultsTable(paper)
        const built = table
          ? buildTableProps(table, {
              row: typeof props.row === 'string' ? props.row : undefined,
              metric: typeof props.metric === 'string' ? props.metric : undefined,
            })
          : null
        if (!built) {
          stats.dropped++
          continue
        }
        shot.props = built
        stats.tables++
      } else if (shot.show === 'EquationScreen' && paper) {
        const ref = props.equation
        const wanted = typeof ref === 'string' ? ref.replace(/[()\s]/g, '') : null
        const eq =
          typeof ref === 'number'
            ? paper.equations[ref]
            : (paper.equations.find((e) => wanted && e.label?.replace(/[()\s]/g, '') === wanted) ??
              paper.equations[0])
        if (!eq || eq.latex.length > 300) {
          stats.dropped++
          continue
        }
        shot.props = {
          latex: eq.latex,
          label: typeof props.label === 'string' ? clip(props.label, 40) : (eq.label ?? ''),
        }
        stats.equations++
      } else if (shot.show === 'FigureZoom' && paper && props.figure !== undefined) {
        const fig = findFigure(paper, props.figure)
        const index = fig ? images.findIndex((i) => i.url === fig.url) : -1
        const { figure: _figure, ...rest } = props
        if (index >= 0) {
          shot.props = { ...rest, image: index }
          stats.figures++
        } else if (Object.keys(rest).length > 0) shot.props = rest
        else delete shot.props
      }
      kept.push(shot)
    }
    if (kept.length > 0) beat.shots = kept
    else delete beat.shots
  }
  return stats
}

/** Prompt block listing what the parsed paper offers, so the model can reference real labels. */
export function paperAssetsPrompt(paper: ParsedPaper, images: readonly ItemImage[]): string {
  const tables = paper.tables
    .filter((t) => buildTableProps(t) !== null)
    .slice(0, 6)
    .map((t) => `- ${t.label ?? 'Table'}: ${clip(t.caption.replace(/\s+/g, ' '), 140)}`)
  const main = mainResultsTable(paper)
  const figures = paper.figures
    .map((f) => ({ f, index: images.findIndex((i) => i.url === f.url) }))
    .filter((x) => x.index >= 0)
    .map(({ f, index }) => `- ${f.label ?? 'Figure'} (image ${index}): ${clip(f.caption, 110)}`)
  const equations = paper.equations
    .slice(0, 4)
    .map((e) => `- ${e.label ?? '(unlabeled)'}: ${clip(e.latex, 120)}`)
  return [
    main ? `Main results table: ${main.label ?? 'Table'}` : null,
    tables.length ? `Tables:\n${tables.join('\n')}` : null,
    figures.length ? `Figures:\n${figures.join('\n')}` : null,
    equations.length ? `Equations:\n${equations.join('\n')}` : null,
  ]
    .filter(Boolean)
    .join('\n')
}
