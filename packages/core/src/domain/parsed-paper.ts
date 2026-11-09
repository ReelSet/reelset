import { z } from 'zod'

export const PAPER_PARSER_VERSION = 1

const cellRef = z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()])

export const paperTableSchema = z.object({
  id: z.string().nullish(),
  label: z.string().nullable(),
  caption: z.string(),
  headers: z.array(z.string()),
  rows: z.array(z.array(z.string())),
  best: z.array(cellRef).default([]),
  second: z.array(cellRef).default([]),
  bestBy: z.enum(['bold', 'computed', 'none']).default('none'),
  notes: z.string().nullish(),
})
export type PaperTable = z.infer<typeof paperTableSchema>

export const paperFigureSchema = z.object({
  id: z.string().nullish(),
  label: z.string().nullable(),
  caption: z.string(),
  url: z.string().max(2048),
  width: z.number().int().positive().nullish(),
  height: z.number().int().positive().nullish(),
  hires: z.boolean(),
  origin: z.enum(['eprint', 'latexml', 'pdf']),
})
export type PaperFigure = z.infer<typeof paperFigureSchema>

export const paperSectionSchema = z.object({
  heading: z.string(),
  level: z.number().int().min(2).max(4),
  kind: z.enum([
    'abstract',
    'intro',
    'related',
    'method',
    'experiments',
    'conclusion',
    'appendix',
    'other',
  ]),
  markdown: z.string(),
})
export type PaperSection = z.infer<typeof paperSectionSchema>

export const parsedPaperSchema = z.object({
  arxivId: z.string(),
  source: z.enum(['html', 'pdf']),
  version: z.number().int(),
  title: z.string(),
  authors: z.array(z.string()),
  affiliations: z.array(z.string()),
  abstract: z.string(),
  sections: z.array(paperSectionSchema),
  tables: z.array(paperTableSchema),
  figures: z.array(paperFigureSchema),
  equations: z.array(z.object({ latex: z.string(), label: z.string().nullish() })),
  links: z.array(z.object({ kind: z.enum(['code', 'project']), url: z.string() })),
  markdown: z.string(),
})
export type ParsedPaper = z.infer<typeof parsedPaperSchema>

export type PaperStats = {
  source: ParsedPaper['source']
  sections: number
  tables: number
  figures: number
  hires: number
  equations: number
  ms?: number
}

/** The number in "Table 3", "Figure 2a" or "tab:3", used to match LLM references to parsed items. */
export function refNumber(ref: string): string | null {
  return /(\d+[a-z]?)\s*$/i.exec(ref.trim())?.[1]?.toLowerCase() ?? null
}

function byRef<T extends { label: string | null }>(
  items: readonly T[],
  ref: unknown,
  word: RegExp,
): T | undefined {
  if (typeof ref === 'number') return items[ref]
  if (typeof ref !== 'string') return undefined
  if (
    /^(?:tab|table)\b/i.test(ref.trim()) !== /tab/.test(word.source) &&
    /^(?:tab|fig)/i.test(ref.trim())
  )
    return undefined
  const n = refNumber(ref)
  if (n === null) return undefined
  return items.find((i) => i.label && word.test(i.label) && refNumber(i.label) === n)
}

export const findTable = (paper: ParsedPaper, ref: unknown) => byRef(paper.tables, ref, /tab/i)
export const findFigure = (paper: ParsedPaper, ref: unknown) => byRef(paper.figures, ref, /fig/i)

const NUMERIC =
  /^[<>~≈≤≥+\-−–]?\s*\d[\d,]*(?:\.\d+)?\s*(?:%|×|x|k|K|M|B)?(?:\s*[±(/]\s*[\d.,]+\)?%?)?\s*[*†‡]*$/
const RESULT_WORDS =
  /result|compar|main|perform|benchmark|accuracy|state[- ]of[- ]the[- ]art|sota|outperform|evaluation|score/i
const SKIP_WORDS = /hyperparam|dataset statistic|statistics|configuration|setting|prompt|notation/i

export const isNumericCell = (s: string): boolean => NUMERIC.test(s.trim())

function numericDensity(t: PaperTable): number {
  const cells = t.rows.flatMap((r) => r.slice(1)).filter((c) => c.trim() !== '')
  return cells.length === 0 ? 0 : cells.filter(isNumericCell).length / cells.length
}

function tableScore(t: PaperTable, index: number): number {
  const text = `${t.label ?? ''} ${t.caption}`
  const density = numericDensity(t)
  if (density < 0.5 || t.rows.length < 2) return -1
  let score = density * 2
  if (RESULT_WORDS.test(text)) score += 2
  if (SKIP_WORDS.test(text)) score -= 3
  if (t.bestBy !== 'none') score += 1.5
  if (/^A\d/.test(t.id ?? '')) score -= 2
  score += Math.min(t.rows.length, 8) / 8 + Math.min(t.headers.length, 6) / 12
  score -= index * 0.12
  return score
}

/** The table most likely to hold the paper's headline comparison, or undefined if none is numeric. */
export function mainResultsTable(paper: ParsedPaper): PaperTable | undefined {
  let best: PaperTable | undefined
  let bestScore = 0
  paper.tables.forEach((t, i) => {
    const s = tableScore(t, i)
    if (s > bestScore) {
      best = t
      bestScore = s
    }
  })
  return best
}

export function tableToMarkdown(t: PaperTable, maxRows = 14, maxCols = 8): string {
  const cols = Math.min(t.headers.length, maxCols)
  const row = (cells: readonly string[], r: number | null) =>
    `| ${cells
      .slice(0, cols)
      .map((c, ci) =>
        r !== null && t.best.some(([br, bc]) => br === r && bc === ci) && c ? `**${c}**` : c,
      )
      .join(' | ')} |`
  const lines = [row(t.headers, null), `|${' --- |'.repeat(cols)}`]
  t.rows.slice(0, maxRows).forEach((cells, r) => lines.push(row(cells, r)))
  if (t.rows.length > maxRows) lines.push(`(${t.rows.length - maxRows} more rows)`)
  return lines.join('\n')
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n).trimEnd()} ...` : s)

export type PaperEvidenceBudget = {
  method: number
  results: number
  conclusion: number
  table: number
}

export const DEFAULT_EVIDENCE_BUDGET: PaperEvidenceBudget = {
  method: 3200,
  results: 3800,
  conclusion: 1200,
  table: 3000,
}

function joinSections(sections: readonly PaperSection[], limit: number): string {
  const out: string[] = []
  let used = 0
  for (const s of sections) {
    if (!s.markdown || used >= limit) continue
    const piece = clip(`${s.heading}: ${s.markdown}`, limit - used)
    out.push(piece)
    used += piece.length
  }
  return out.join('\n\n')
}

/**
 * Evidence texts for the reel LLM: method, results, the main results table (with its label and caption
 * so numbers can be quoted) and the conclusion. Abstract comes from the mention body already.
 */
export function paperEvidenceTexts(
  paper: ParsedPaper,
  budget: PaperEvidenceBudget = DEFAULT_EVIDENCE_BUDGET,
): string[] {
  const pick = (kind: PaperSection['kind']) => paper.sections.filter((s) => s.kind === kind)
  const method = joinSections(pick('method'), budget.method)
  const results = joinSections(pick('experiments'), budget.results)
  const conclusion = joinSections(pick('conclusion'), budget.conclusion)
  const intro = joinSections(pick('intro'), method || results ? 1500 : 3500)
  const table = mainResultsTable(paper)
  const out: string[] = []
  if (intro) out.push(`Introduction: ${intro}`)
  if (method) out.push(`Method: ${method}`)
  if (results) out.push(`Experiments and results: ${results}`)
  if (table) {
    const head = `${table.label ?? 'Table'}${table.caption ? `: ${clip(table.caption, 260)}` : ''}`
    const note =
      table.bestBy === 'bold'
        ? 'Best results are in bold.'
        : table.bestBy === 'computed'
          ? 'Best results are in bold (marked from the column arrows).'
          : ''
    out.push(clip(`Results table. ${head} ${note}\n${tableToMarkdown(table)}`, budget.table))
  }
  if (conclusion) out.push(`Conclusion: ${conclusion}`)
  return out
}
