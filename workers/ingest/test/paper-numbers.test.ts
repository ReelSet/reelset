import { describe, expect, it } from 'vitest'
import type { PaperTable, ParsedPaper } from '@reelset/core'
import { buildTableProps, narratedAt, resolvePaperShots } from '../src/pipeline/paper-shots'
import table1 from './fixtures/mopd-table1.json'

// Table 1 of arXiv 2611.03953 (P²-MOPD): a Qwen3-4B block, then a "Qwen3-1.7B" separator row and the 1.7B block.
const table = table1 as unknown as PaperTable
const SENTENCE =
  "For a 1.7B model, P^2-MOPD achieved 94.7% average recovery, surpassing MOPD's 80.9%."

describe('tables follow the narration', () => {
  it('finds the quantity spoken nearest the cue', () => {
    expect(narratedAt(SENTENCE, 'recovery')).toEqual({
      raw: '94.7%',
      label: 'P^2-MOPD average recovery',
    })
    expect(narratedAt(SENTENCE, 'surpassing')).toEqual({
      raw: '80.9%',
      label: 'MOPD average recovery',
    })
    expect(narratedAt('No numbers here.', 'numbers')).toBeNull()
  })

  it('highlights the narrated cell inside its own section of a sectioned table', () => {
    const props = buildTableProps(table, { value: '80.9%' })!
    expect(props.ref).toBe('Table 1 · Qwen3-1.7B')
    const rows = props.rows as string[]
    const hi = rows[props.hi as number]!.split('|')
    expect(hi[0]).toBe('MOPD (TA init)')
    expect(props.value).toMatch(/^80\.93/)
    expect(props.label).toBe('Avg. Recovery')
    expect(rows.some((r) => r.startsWith('P2-MOPD|78.74'))).toBe(false)
  })

  it('never mixes rows from two sections', () => {
    const props = buildTableProps(table)!
    const values = (props.rows as string[]).map((r) => r.split('|')[1])
    expect(values.includes('57.20') && values.includes('78.74')).toBe(false)
    expect(props.ref).toBe('Table 1 · Qwen3-1.7B')
  })

  it('turns a table shot into a grounded StatSlam when no table holds the narrated number', () => {
    const paper = { tables: [table], figures: [], equations: [] } as unknown as ParsedPaper
    const script = {
      beats: [
        {
          text: 'It also raised worst-domain recovery to nearly 91.3%.',
          shots: [{ at: 'recovery', show: 'TableScreen', props: { table: 'Table 1' } }],
        },
        {
          text: SENTENCE,
          shots: [{ at: 'surpassing', show: 'TableScreen', props: { table: 'Table 1' } }],
        },
      ],
    }
    const stats = resolvePaperShots(script, paper, [])
    const [a, b] = script.beats.map((x) => x.shots[0]!) as {
      show: string
      props: Record<string, unknown>
    }[]
    expect(a!.show).toBe('StatSlam')
    expect(a!.props).toEqual({ value: '~91.3%', label: 'worst-domain recovery' })
    expect(b!.show).toBe('TableScreen')
    expect(String(b!.props.value)).toMatch(/^80\.93/)
    expect(stats).toMatchObject({ tables: 1, stats: 1 })
  })
})
