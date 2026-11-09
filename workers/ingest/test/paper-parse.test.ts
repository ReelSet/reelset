import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { parsedPaperSchema, type ItemImage, type ParsedPaper } from '@reelset/core'
import { pdfMarkdownEvidence } from '../src/arxiv-html'
import { paperFigureImages } from '../src/images'
import { arxivIdFromKey, createPaperClient } from '../src/paper-client'
import { buildTableProps, paperAssetsPrompt, resolvePaperShots } from '../src/pipeline/paper-shots'
import { processItem } from '../src/pipeline/process'
import { ITEM_ID, makeDeps, makeWorld, validOutput } from './helpers/process-deps'
import { testLog } from './helpers/mock-fetch'

const paper: ParsedPaper = parsedPaperSchema.parse(
  JSON.parse(readFileSync(new URL('./fixtures/parsed-paper.json', import.meta.url), 'utf8')),
)

const images: ItemImage[] = paper.figures.map((f) => ({
  url: f.url,
  kind: 'figure',
  width: f.width ?? undefined,
}))

describe('buildTableProps on a real multirow table', () => {
  const table1 = paper.tables.find((t) => t.label === 'Table 1')!

  it('keeps a phone-sized slice with the best row highlighted', () => {
    const props = buildTableProps(table1)!
    const rows = props.rows as string[]
    expect(rows.length).toBeLessThanOrEqual(6)
    expect((props.headers as string[]).length).toBeLessThanOrEqual(4)
    expect(props.headers).toEqual(expect.arrayContaining(['Method']))
    expect(rows[props.hi as number]).toMatch(/^Ours/)
    expect(props.ref).toBe('Table 1')
    expect(String(props.value)).toMatch(/^\d/)
    expect(props.col).toBeGreaterThanOrEqual(1)
  })

  it('honours the row and metric the model asked for', () => {
    const props = buildTableProps(table1, { row: 'AnySplat', metric: 'LPIPS' })!
    expect((props.rows as string[])[props.hi as number]).toMatch(/^AnySplat\|/)
    expect(String(props.label)).toContain('LPIPS')
  })

  it('stays within the container prop limits', () => {
    const props = buildTableProps(table1)!
    expect(Object.keys(props).length).toBeLessThanOrEqual(12)
    expect(JSON.stringify(props)).not.toMatch(/true|false/)
    for (const v of Object.values(props)) {
      if (Array.isArray(v)) expect(v.length).toBeLessThanOrEqual(8)
      if (typeof v === 'string') expect(v.length).toBeLessThanOrEqual(400)
    }
  })

  it('returns null for a table without numbers', () => {
    expect(
      buildTableProps({
        ...table1,
        rows: [
          ['A', 'x', 'y'],
          ['B', 'z', 'w'],
        ],
        best: [],
      }),
    ).toBeNull()
  })
})

describe('resolvePaperShots', () => {
  const script = () => ({
    beats: [
      {
        text: 'a',
        shots: [
          { at: 'a', show: 'TableScreen', props: { table: 'Table 1' } },
          { at: 'b', show: 'TableScreen', props: { table: 'Table 77' } },
          { at: 'c', show: 'EquationScreen', props: { equation: '(1)' } },
          { at: 'd', show: 'FigureZoom', props: { figure: 'Figure 2' } },
          { at: 'e', show: 'KeyPoint', props: { text: 'x' } },
        ],
      },
    ],
  })

  it('fills real props, falls back to the main table and resolves figure labels to image indexes', () => {
    const s = script()
    const stats = resolvePaperShots(s, paper, images)
    const shots = s.beats[0]!.shots as { show: string; props: Record<string, unknown> }[]
    expect(shots.map((x) => x.show)).toEqual([
      'TableScreen',
      'TableScreen',
      'EquationScreen',
      'FigureZoom',
      'KeyPoint',
    ])
    expect(shots[0]!.props.rows).toBeInstanceOf(Array)
    expect(shots[2]!.props.latex).toBe(paper.equations[0]!.latex)
    expect(shots[3]!.props).toEqual({
      image: images.findIndex((i) => i.url === paper.figures[1]!.url),
    })
    expect(stats).toMatchObject({ tables: 2, equations: 1, figures: 1, dropped: 0 })
  })

  it('removes paper-only screens when no paper was parsed', () => {
    const s = script()
    const stats = resolvePaperShots(s, null, images)
    expect((s.beats[0]!.shots as { show: string }[]).map((x) => x.show)).toEqual([
      'FigureZoom',
      'KeyPoint',
    ])
    expect(stats.dropped).toBe(3)
  })

  it('lists real labels for the prompt', () => {
    const text = paperAssetsPrompt(paper, images)
    expect(text).toContain('Main results table: Table')
    expect(text).toContain('Figure 1 (image 0)')
    expect(text).toContain('(1):')
  })
})

describe('paper figures as item images', () => {
  it('prefers original-resolution figures when there are enough', () => {
    const p: ParsedPaper = {
      ...paper,
      figures: [
        {
          label: 'Figure 1',
          caption: 'a',
          url: 'https://arxiv.org/html/x/x1.png',
          hires: false,
          origin: 'latexml',
        },
        {
          label: 'Figure 2',
          caption: 'b',
          url: 'https://m.test/p/fig-2.png',
          hires: true,
          origin: 'eprint',
          width: 1600,
        },
        {
          label: 'Figure 3',
          caption: 'c',
          url: 'https://m.test/p/fig-3.png',
          hires: true,
          origin: 'eprint',
          width: 2400,
        },
      ],
    }
    const out = paperFigureImages(p)
    expect(out.map((i) => i.url)).toEqual([
      'https://m.test/p/fig-2.png',
      'https://m.test/p/fig-3.png',
    ])
    expect(out[0]).toMatchObject({ kind: 'figure', width: 1600, alt: 'Figure 2: b' })
  })
})

describe('createPaperClient', () => {
  const fetcherOf = (res: () => Response | Promise<Response>) => ({
    fetch: vi.fn(async (_url: string, _init?: RequestInit) => res()),
  })

  it('returns the parsed paper', async () => {
    const f = fetcherOf(() => Response.json({ status: 'ok', paper }))
    expect(await createPaperClient(f, testLog).parse('2611.08264')).toMatchObject({
      title: paper.title,
    })
    expect(JSON.parse(String(f.fetch.mock.calls[0]![1]!.body))).toEqual({ arxivId: '2611.08264' })
  })

  it('returns null on failed status, bad json, http errors and network errors', async () => {
    for (const make of [
      () => Response.json({ status: 'failed', reason: 'not_parseable' }),
      () => new Response('nope', { status: 502 }),
      () => Response.json({ status: 'ok', paper: { title: 1 } }),
      () => {
        throw new Error('boom')
      },
    ]) {
      expect(await createPaperClient(fetcherOf(make), testLog).parse('2611.08264')).toBeNull()
    }
  })

  it('extracts arxiv ids from canonical keys', () => {
    expect(arxivIdFromKey('arxiv:hep-th/9711200')).toBe('hep-th/9711200')
    expect(arxivIdFromKey('github:a/b')).toBeNull()
  })
})

describe('pdfMarkdownEvidence', () => {
  it('keeps the method, results and conclusion bodies', () => {
    const body = (w: string) => `${w} `.repeat(80)
    const md = `# Title\n\n## 1 Introduction\n${body('intro')}\n## 2 Method\n${body('method')}\n## 3 Experiments\n${body('exp')}\n## References\n${body('ref')}`
    const out = pdfMarkdownEvidence(md)
    expect(out.map((t) => t.split(':')[0])).toEqual([
      'Introduction',
      'Method',
      'Experiments and results',
    ])
    expect(out.join(' ')).not.toContain('ref ref')
  })
})

describe('summarize with a parsed paper', () => {
  const chunkIds = Array.from({ length: 3 }, (_, i) => `bbbbbbbb-bbbb-4bbb-8bbb-00000000000${i}`)
  const world = () =>
    makeWorld({
      canonicalKey: 'arxiv:2611.08264',
      mentions: [
        {
          id: 'm1',
          source: 'papers',
          external_id: '2611.08264',
          url: 'https://arxiv.org/abs/2611.08264',
          title: paper.title,
          body: `Abstract: ${paper.abstract}`,
          raw: { extraTexts: ['Introduction: old regex text '.repeat(30)] },
        },
      ],
      chunks: chunkIds.map((id, i) => ({ id, text: `Evidence ${i}. `.repeat(30) })),
    })
  const output = (extra: Record<string, unknown>) =>
    validOutput(chunkIds[0], {
      beats: [
        {
          text: 'It beats the baselines on every benchmark',
          visual: { type: 'title', title: 'Results' },
          shots: [{ at: 'beats', show: 'TableScreen', props: { table: 'Table 1', row: 'Ours' } }],
        },
        { text: 'Two', visual: { type: 'title', title: 'Two' } },
      ],
      ...extra,
    })

  it('uses parsed sections and the results table as evidence and resolves table shots', async () => {
    const t = makeDeps(world(), [output({})])
    const parse = vi.fn(async () => paper)
    t.deps.papers = { parse }
    await processItem(t.deps, ITEM_ID, 1)
    expect(parse).toHaveBeenCalledWith('2611.08264')
    const inserted = t.fake
      .find('insert into "evidence_chunk"')
      .flatMap((q) => q.params)
      .join(' ')
    expect(inserted).toContain('Results table. Table')
    expect(inserted).toContain('Method:')
    expect(inserted).not.toContain('old regex text')
    const user = t.generate.mock.calls[0]![0].user
    expect(user).toContain('PAPER_ASSETS:')
    const stored = t.fake
      .find('"script" =')[0]!
      .params.find((p) => typeof p === 'string' && p.startsWith('{"version"')) as string
    const shot = JSON.parse(stored).beats[0].shots[0]
    expect(shot.show).toBe('TableScreen')
    expect(shot.props.rows.length).toBeGreaterThan(1)
    expect(shot.props.table).toBeUndefined()
  })

  it('falls back to the old evidence and drops table shots when parsing fails', async () => {
    const t = makeDeps(world(), [output({})])
    t.deps.papers = { parse: vi.fn(async () => null) }
    await processItem(t.deps, ITEM_ID, 1)
    const inserted = t.fake
      .find('insert into "evidence_chunk"')
      .flatMap((q) => q.params)
      .join(' ')
    expect(inserted).toContain('old regex text')
    expect(t.generate.mock.calls[0]![0].user).not.toContain('PAPER_ASSETS:')
    const stored = t.fake
      .find('"script" =')[0]!
      .params.find((p) => typeof p === 'string' && p.startsWith('{"version"')) as string
    expect(JSON.parse(stored).beats[0].shots).toBeUndefined()
  })
})
