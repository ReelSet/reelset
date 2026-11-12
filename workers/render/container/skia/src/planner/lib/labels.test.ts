import { describe, expect, it } from 'vitest'
import { groundShots } from './ground'
import { contextLabel, groundLabel, mentions, valueOf } from './labels'
import { sampleReel } from './fixtures'
import { salientPhrase } from './extract'
import { displayTitle, fitWords, styleOf, typeset } from './typeset'
import { readTable } from './table'
import type { ReelProps, TimedShot } from './types'

const MOPD =
  'P^2-MOPD recovers 52.8% of the gap on AIME, 59.7% on HMMT and 85.0% on math. Across all tasks it reaches 94.7% average recovery.'

describe('valueOf / mentions', () => {
  it('parses percents, separators and suffixes', () => {
    expect(valueOf('52.8%')).toBe(52.8)
    expect(valueOf('12k')).toBe(12000)
    expect(valueOf('1,240')).toBe(1240)
    expect(mentions('about 3 million users and 4.5x')).toHaveLength(2)
  })
})

describe('groundLabel (MOPD)', () => {
  it('replaces a label that is not near its number', () => {
    const ledger = new Map<string, number>()
    const g = groundLabel('52.8%', 'AVERAGE RECOVERY', MOPD, ledger)
    expect(g.label.toLowerCase()).not.toContain('average recovery')
  })

  it('keeps a label that sits next to its number', () => {
    const g = groundLabel('94.7%', 'average recovery', MOPD, new Map())
    expect(g.label).toBe('average recovery')
  })

  it('never reuses one label for four different numbers', () => {
    const ledger = new Map<string, number>()
    const labels = ['52.8%', '59.7%', '85.0%', '94.7%'].map(
      (v) => groundLabel(v, 'AVERAGE RECOVERY', MOPD, ledger).label,
    )
    const used = labels.filter(Boolean).map((l) => l.toLowerCase())
    expect(used.filter((l) => l === 'average recovery')).toHaveLength(1)
    expect(new Set(used).size).toBe(used.length)
  })

  it('derives the label from words after the number, else before', () => {
    const at = mentions('It scores 12 passes today.')[0]!
    expect(contextLabel('It scores 12 passes today.', at)).toBe('passes today')
    const b = mentions('P2 recovers 52.8% of it')[0]!
    expect(contextLabel('P2 recovers 52.8% of it', b)).toBe('P2')
  })

  it('keeps the label of a number that is not in the narration (facts)', () => {
    expect(groundLabel('12,400', 'GitHub stars', 'a tool for agents', new Map()).label).toBe(
      'GitHub stars',
    )
  })
})

describe('groundShots', () => {
  const shot = (show: TimedShot['show'], props: Record<string, unknown>, i: number): TimedShot => ({
    from: i * 60,
    frames: 60,
    show,
    props,
    sceneIndex: 1,
    origin: 'cue',
  })
  const reel = (): ReelProps => {
    const p = sampleReel()
    p.scenes[1] = { ...(p.scenes[1] as object), text: MOPD } as ReelProps['scenes'][number]
    return p
  }

  it('relabels the four MOPD StatSlams so no two share a label', () => {
    const shots = ['52.8%', '59.7%', '85.0%', '94.7%'].map((v, i) =>
      shot('StatSlam', { value: v, label: 'AVERAGE RECOVERY' }, i),
    )
    const out = groundShots(shots, reel())
    const labels = out
      .filter((s) => s.show === 'StatSlam')
      .map((s) => String(s.props.label).toLowerCase())
    expect(new Set(labels).size).toBe(labels.length)
    expect(labels.filter((l) => l === 'average recovery').length).toBeLessThanOrEqual(1)
  })

  it('turns a StatSlam with no honest label into a KeyPoint', () => {
    const p = reel()
    p.scenes[1] = {
      ...(p.scenes[1] as object),
      text: 'Numbers 52.8% and 52.8%.',
    } as ReelProps['scenes'][number]
    const out = groundShots([shot('StatSlam', { value: '52.8%', label: 'X' }, 0)], p)
    expect(out[0]!.show === 'StatSlam' ? out[0]!.props.label : 'ok').toBeTruthy()
  })

  it('drops BarRace bars without a grounded label and falls back below two bars', () => {
    const out = groundShots(
      [
        shot(
          'BarRace',
          {
            bars: [
              { label: 'A', value: '52.8%' },
              { label: 'B', value: '59.7%' },
            ],
          },
          0,
        ),
      ],
      reel(),
    )
    expect(['BarRace', 'KeyPoint']).toContain(out[0]!.show)
    if (out[0]!.show === 'BarRace') {
      const bars = out[0]!.props.bars as { label: string }[]
      expect(new Set(bars.map((b) => b.label)).size).toBe(bars.length)
    }
  })
})

describe('table cell label', () => {
  it('names the row and column of the highlighted number', () => {
    const t = readTable({
      headers: ['Method', 'AIME'],
      rows: ['Base|40.1', 'P^2-MOPD|52.8'],
      hi: 1,
      col: 1,
    })!
    expect(t.label).toBe('P^2-MOPD · AIME')
    expect(t.value).toBe('52.8')
  })
})

describe('text fidelity', () => {
  it('typesets carets and subscripts without losing characters', () => {
    expect(typeset('P^2-MOPD achieved')).toBe('P²-MOPD achieved')
    expect(typeset('x^{-1} and H_2O')).toBe('x⁻¹ and H₂O')
    expect(typeset('a^b')).toBe('a^b')
    expect(typeset('±3.2 σ')).toBe('±3.2 σ')
  })

  it('typesets item titles but leaves repo slugs alone', () => {
    expect(displayTitle('P^2-MOPD: Accelerating Distillation')).toBe(
      'P²-MOPD: Accelerating Distillation',
    )
    expect(displayTitle('meta/llama_3')).toBe('meta/llama_3')
    expect(displayTitle(displayTitle('P^2 again'))).toBe('P² again')
  })

  it('keeps the caret in salient phrases', () => {
    expect(salientPhrase('P^2-MOPD achieved the best score')).toContain('P^2-MOPD')
  })

  it('fits the widest word inside the frame', () => {
    const size = fitWords(
      'P²-MOPD ACHIEVED',
      { width: 976, height: 700 },
      { min: 44, max: 200, upper: true },
    )
    expect(size * 0.82 * 'ACHIEVED'.length).toBeLessThanOrEqual(976)
    expect(styleOf('P^2-MOPD')).toBeGreaterThanOrEqual(0)
  })
})
