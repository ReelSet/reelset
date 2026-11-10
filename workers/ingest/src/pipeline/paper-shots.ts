import {
  findFigure,
  findTable,
  isNumericCell,
  mainResultsTable,
  type ItemImage,
  type PaperTable,
  type ParsedPaper,
} from '@reelset/core'
import { findQuantities, numberLabel, sameNumber } from './text-rules'

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

export type TableHint = {
  row?: string
  metric?: string
  value?: string
  /** Other numbers said in the same sentence ("surpassing MOPD's 80.9%"): each must be a cell too. */
  others?: readonly string[]
}

const BASELINE = /\b(?:base(?:line)?|vanilla|original|default|naive|w\/o|without)\b/i
/** Rows a narrated table shows: the narrated one, the ones it is compared with and a baseline. */
export const MAX_NARRATED_ROWS = 4

/** Rows with a label and no numbers ("Qwen3-1.7B") split a table into sections; [start, end) of the row's section. */
function sectionOf(t: PaperTable, numeric: readonly number[], labelCol: number, row: number) {
  const isSep = (r: number) =>
    (t.rows[r]?.[labelCol] ?? '').trim() !== '' &&
    numeric.every((c) => (t.rows[r]?.[c] ?? '').trim() === '')
  let start = 0
  for (let r = row; r >= 0; r -= 1)
    if (isSep(r)) {
      start = r + 1
      break
    }
  let end = t.rows.length
  for (let r = row + 1; r < t.rows.length; r += 1)
    if (isSep(r)) {
      end = r
      break
    }
  const name = start > 0 ? (t.rows[start - 1]?.[labelCol] ?? '').trim() : ''
  return { start, end, name }
}

/** The cell holding a narrated number (rounded to the narration's precision), best column first. */
export function findCell(
  t: PaperTable,
  value: string,
  metric = '',
): { row: number; col: number } | null {
  const numeric = numericColumns(t)
  const m = metric.toLowerCase()
  const hits: { row: number; col: number; score: number }[] = []
  t.rows.forEach((cells, r) =>
    numeric.forEach((c) => {
      if (!sameNumber(value, cells[c] ?? '')) return
      const header = (t.headers[c] ?? '').toLowerCase()
      const shared = m
        .split(/\W+/)
        .filter((w) => w.length > 2 && header.includes(w.slice(0, 3))).length
      hits.push({ row: r, col: c, score: shared })
    }),
  )
  const best = hits.sort((a, b) => b.score - a.score || a.row - b.row)[0]
  return best ? { row: best.row, col: best.col } : null
}

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
  const target = hint.value ? findCell(t, hint.value, hint.metric) : null
  if (hint.value && !target) return null
  const chosen = [...numeric]
    .sort((a, b) => {
      const ca = target?.col === a ? 2 : 0
      const cb = target?.col === b ? 2 : 0
      const ma = metric && t.headers[a]!.toLowerCase().includes(metric) ? 1 : 0
      const mb = metric && t.headers[b]!.toLowerCase().includes(metric) ? 1 : 0
      return cb + mb - (ca + ma) || bestCount(b) - bestCount(a) || a - b
    })
    .slice(0, MAX_TABLE_VALUE_COLS)
    .sort((a, b) => a - b)

  const hasValue = (r: number) => chosen.some((c) => isNumericCell(t.rows[r]?.[c] ?? ''))
  const all = t.rows.map((_, r) => r).filter(hasValue)
  if (all.length < 2) return null

  const wanted = hint.row?.toLowerCase().trim()
  const byHint = wanted
    ? all.find((r) => (t.rows[r]![labelCol] ?? '').toLowerCase().includes(wanted))
    : undefined
  const bestScore = (r: number) => chosen.filter((c) => bestAt(r, c)).length
  const byBest = [...all].sort((a, b) => bestScore(b) - bestScore(a) || b - a)[0]
  const byOurs = [...all].reverse().find((r) => OURS.test(t.rows[r]![labelCol] ?? ''))
  const hi =
    target?.row ?? byHint ?? (bestScore(byBest!) > 0 ? byBest! : (byOurs ?? all[all.length - 1]!))
  const section = sectionOf(t, numeric, labelCol, hi)
  const eligible = all.filter((r) => r >= section.start && r < section.end)
  if (eligible.length < 2) return null

  let picked: number[]
  if (target) {
    // Narrated: only the rows the sentence talks about, each with a name no other row shares.
    const rowsSaid = [hi]
    for (const other of hint.others ?? []) {
      const r = eligible.find(
        (row) => row !== hi && chosen.some((c) => sameNumber(other, t.rows[row]?.[c] ?? '')),
      )
      if (r === undefined) return null
      rowsSaid.push(r)
    }
    const name = (r: number) => (t.rows[r]![labelCol] ?? '').trim().toLowerCase()
    if (rowsSaid.some((r) => !name(r) || eligible.filter((x) => name(x) === name(r)).length > 1))
      return null
    const base = eligible.find((r) => !rowsSaid.includes(r) && BASELINE.test(name(r)))
    picked = [...new Set([...rowsSaid, ...(base === undefined ? [] : [base])])]
      .slice(0, MAX_NARRATED_ROWS)
      .sort((a, b) => a - b)
  } else {
    const priority = [hi, ...eligible.filter((r) => r !== hi && bestScore(r) > 0), ...eligible]
    picked = [...new Set(priority)].slice(0, MAX_TABLE_ROWS).sort((a, b) => a - b)
  }

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
    (target ? chosen.indexOf(target.col) + 1 : 0) ||
      chosen.findIndex((c) => bestAt(hi, c)) + 1 ||
      (metric ? chosen.findIndex((c) => t.headers[c]!.toLowerCase().includes(metric)) + 1 : 0) ||
      1,
  )
  const props: Obj = {
    ref: section.name ? `${t.label ?? 'Table'} · ${clip(section.name, 24)}` : (t.label ?? 'Table'),
    caption: clip(t.caption.replace(/\s+/g, ' '), 150),
    headers,
    rows: rows.map((r) => r.map(cell).join('|')),
    hi: hiRow,
    col: keyCol,
    value: rows[hiRow]![keyCol] ?? '',
    label: headers[keyCol] ?? '',
  }
  if (bestCells.length > 0 && !target) props.best = bestCells.slice(0, 8)
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

/** The quantity spoken nearest the shot's cue word (in its sentence), with what the sentence says it is. */
export function narratedAt(
  text: string,
  cue: unknown,
): { raw: string; label: string; others: string[] } | null {
  const word =
    typeof cue === 'string'
      ? cue
          .split('#')[0]!
          .toLowerCase()
          .replace(/[^\p{L}\p{N}]/gu, '')
      : ''
  const sentence =
    text.split(/(?<=[.!?])\s+/).find((s) =>
      s
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, '')
        .split(/\s+/)
        .includes(word),
    ) ?? ''
  const at = sentence
    .toLowerCase()
    .search(new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '')}`))
  const qs = findQuantities(sentence)
  const best = [...qs].sort((a, b) => Math.abs(a.index - at) - Math.abs(b.index - at))[0]
  if (!best) return null
  const others = qs
    .filter((q) => q !== best && q.unit === best.unit && q.value !== best.value)
    .map((q) => q.raw)
  return {
    raw: best.raw,
    label: numberLabel(sentence, { start: best.index, end: best.end }),
    others,
  }
}

export type ResolveStats = {
  tables: number
  equations: number
  figures: number
  dropped: number
  stats: number
}

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
  const stats: ResolveStats = { tables: 0, equations: 0, figures: 0, dropped: 0, stats: 0 }
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
        const named = props.table !== undefined ? findTable(paper, props.table) : undefined
        const table = named ?? mainResultsTable(paper)
        const hint = {
          row: typeof props.row === 'string' ? props.row : undefined,
          metric: typeof props.metric === 'string' ? props.metric : undefined,
        }
        const said = narratedAt(typeof beat.text === 'string' ? beat.text : '', shot.at)
        if (said) {
          const tables = [table, ...paper.tables].filter((x): x is PaperTable => Boolean(x))
          const withIt = tables
            .map((x) => buildTableProps(x, { ...hint, value: said.raw, others: said.others }))
            .find((x) => x !== null)
          if (withIt) {
            shot.props = withIt
            stats.tables++
          } else {
            shot.show = 'StatSlam'
            shot.props = { value: said.raw, label: said.label }
            stats.stats++
          }
          kept.push(shot)
          continue
        }
        const built = table ? buildTableProps(table, hint) : null
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
