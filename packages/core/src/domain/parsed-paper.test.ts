import { describe, expect, it } from 'vitest'
import {
  findFigure,
  findTable,
  isNumericCell,
  mainResultsTable,
  paperEvidenceTexts,
  refNumber,
  tableToMarkdown,
  type ParsedPaper,
  type PaperTable,
} from './parsed-paper'

const table = (over: Partial<PaperTable>): PaperTable => ({
  id: 'S4.T1',
  label: 'Table 1',
  caption: 'Main results on three benchmarks',
  headers: ['Method', 'MMLU', 'GSM8K'],
  rows: [
    ['Base', '61.2', '50.1'],
    ['Ours', '68.4', '57.9'],
  ],
  best: [
    [1, 1],
    [1, 2],
  ],
  second: [],
  bestBy: 'bold',
  notes: null,
  ...over,
})

const paper = (tables: PaperTable[]): ParsedPaper => ({
  arxivId: '2611.00001',
  source: 'html',
  version: 1,
  title: 'T',
  authors: [],
  affiliations: [],
  abstract: 'abs',
  sections: [
    { heading: 'Introduction', level: 2, kind: 'intro', markdown: 'We study X.' },
    { heading: 'Method', level: 2, kind: 'method', markdown: 'We add $a=b$ to the loss.' },
    {
      heading: 'Results',
      level: 2,
      kind: 'experiments',
      markdown: 'Ours beats base by 7.2 points.',
    },
    { heading: 'Proofs', level: 2, kind: 'appendix', markdown: 'Appendix text.' },
    { heading: 'Conclusion', level: 2, kind: 'conclusion', markdown: 'Done.' },
  ],
  tables,
  figures: [
    {
      label: 'Figure 2',
      caption: 'Overview',
      url: 'https://m/f2.png',
      hires: true,
      origin: 'eprint',
    },
  ],
  equations: [],
  links: [],
  markdown: '',
})

describe('references', () => {
  it('matches labels by number and by index', () => {
    const p = paper([table({}), table({ label: 'Table 4' })])
    expect(refNumber('Table 4')).toBe('4')
    expect(findTable(p, 'tab:4')?.label).toBe('Table 4')
    expect(findTable(p, 'Table 9')).toBeUndefined()
    expect(findTable(p, 0)?.label).toBe('Table 1')
    expect(findFigure(p, 'Figure 2')?.url).toBe('https://m/f2.png')
    expect(findFigure(p, 'Table 2')).toBeUndefined()
  })
})

describe('numeric cells', () => {
  it('accepts scores, percents and plus-minus values', () => {
    for (const ok of ['61.2', '96.20 ± 0.86', '+29.0±8.3', '50.99%', '1,089', '2.1×'])
      expect(isNumericCell(ok)).toBe(true)
    for (const bad of ['Ours', 'w/o Pose', '']) expect(isNumericCell(bad)).toBe(false)
  })
})

describe('mainResultsTable', () => {
  it('prefers a numeric results table over a text table and an appendix table', () => {
    const text = table({
      label: 'Table 1',
      caption: 'Benchmark taxonomy',
      rows: [
        ['A', 'Preserve entities', 'Check graph'],
        ['B', 'Render layout', 'Check scale'],
      ],
    })
    const appendix = table({ id: 'A1.T9', label: 'Table 9', caption: 'Hyperparameters' })
    const main = table({ id: 'S4.T2', label: 'Table 2' })
    expect(mainResultsTable(paper([text, appendix, main]))?.label).toBe('Table 2')
  })

  it('returns undefined when no table is numeric', () => {
    const text = table({
      rows: [
        ['A', 'x', 'y'],
        ['B', 'z', 'w'],
      ],
    })
    expect(mainResultsTable(paper([text]))).toBeUndefined()
  })
})

describe('tableToMarkdown', () => {
  it('bolds best cells and notes truncated rows', () => {
    const t = table({})
    expect(tableToMarkdown(t)).toContain('| Ours | **68.4** | **57.9** |')
    expect(tableToMarkdown(t, 1)).toContain('(1 more rows)')
  })
})

describe('paperEvidenceTexts', () => {
  it('orders method, results, the main table and conclusion, and leaves out the appendix', () => {
    const texts = paperEvidenceTexts(paper([table({})]))
    expect(texts.map((t) => t.split(':')[0])).toEqual([
      'Introduction',
      'Method',
      'Experiments and results',
      'Results table. Table 1',
      'Conclusion',
    ])
    expect(texts.join('\n')).toContain('$a=b$')
    expect(texts.join('\n')).not.toContain('Appendix text')
    expect(texts.find((t) => t.startsWith('Results table'))).toContain('Best results are in bold.')
  })

  it('respects the character budget', () => {
    const big = paper([table({})])
    big.sections[1]!.markdown = 'word '.repeat(5000)
    const method = paperEvidenceTexts(big).find((t) => t.startsWith('Method'))!
    expect(method.length).toBeLessThan(3400)
  })
})
