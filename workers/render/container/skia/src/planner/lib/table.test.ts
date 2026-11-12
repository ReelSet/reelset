import { describe, expect, it } from 'vitest'
import { columnWidths, fitLabel, holdFor, readTable, rowHeight, focusTable } from './table'

const props = {
  ref: 'Table 2',
  caption: 'Main results',
  headers: ['Method', 'MMLU', 'GSM8K'],
  rows: ['Base|61.2|50.1', 'Ours|68.4|57.9'],
  hi: 1,
  col: 1,
  best: ['1:1', '1:2'],
  value: '68.4',
  label: 'MMLU',
}

describe('readTable', () => {
  it('reads shot props into a table view', () => {
    const t = readTable(props)!
    expect(t.rows).toEqual([
      ['Base', '61.2', '50.1'],
      ['Ours', '68.4', '57.9'],
    ])
    expect(t.best.has('1:2')).toBe(true)
    expect(t.value).toBe('68.4')
  })

  it('pads short rows and clamps indexes', () => {
    const t = readTable({ ...props, rows: ['Only label'], hi: 9, col: 9 })!
    expect(t.rows[0]).toEqual(['Only label', '', ''])
    expect([t.hi, t.col]).toEqual([0, 2])
  })

  it('falls back to the cell value when value/label are missing', () => {
    const { value: _v, label: _l, ...rest } = props
    const t = readTable(rest)!
    expect([t.value, t.label]).toEqual(['68.4', 'Ours · MMLU'])
  })

  it('marks the highlighted cell, and none for a plain table', () => {
    expect(readTable(props)!.mark).toEqual({ row: 1, col: 1 })
    const t = readTable({ ...props, plain: true })!
    expect([t.mark, t.value, t.label]).toEqual([null, '', ''])
    expect([t.hi, t.col]).toEqual([1, 1])
  })

  it('returns null for unusable props', () => {
    expect(readTable({})).toBeNull()
    expect(readTable({ headers: ['a'], rows: ['x'] })).toBeNull()
    expect(readTable({ headers: ['a', 'b'], rows: [] })).toBeNull()
  })
})

describe('layout helpers', () => {
  it('splits the width with a wider label column and no lost pixels', () => {
    for (const n of [2, 3, 4]) {
      const w = columnWidths(n, 894)
      expect(w.reduce((a, b) => a + b, 0)).toBe(894)
      expect(w[0]).toBeGreaterThanOrEqual(w[1]!)
    }
  })

  it('shrinks rows to fit but stays readable', () => {
    expect(rowHeight(770, 6)).toBeGreaterThanOrEqual(60)
    expect(rowHeight(770, 6)).toBeLessThanOrEqual(124)
    expect(rowHeight(500, 6)).toBe(60)
    expect(rowHeight(900, 2)).toBe(124)
  })

  it('shrinks long labels with a floor', () => {
    expect(fitLabel('Ours', 300, 40, 24)).toBe(40)
    expect(fitLabel('A very long baseline method name (pose cond.)', 300, 40, 24)).toBe(24)
  })

  it('holds tables and equations longer than normal shots', () => {
    expect(holdFor('TableScreen')!.gap).toBeGreaterThan(2)
    expect(holdFor('KeyPoint')).toBeUndefined()
  })
})

describe('focusTable', () => {
  const view = {
    headers: ['Method', 'MedQA', 'Avg. Recovery'],
    hi: 0,
    rows: [
      ['Base student', '44.10', '0'],
      ['MOPD (TA init)', '48.87', '80.93'],
      ['IM-MOPD', '55.22', '67.81'],
      ['P2-MOPD', '57.20', '94.74'],
    ],
  }

  it('shows the narrated row, the compared row and the baseline, highlighting only the said cell', () => {
    const f = focusTable(view, { row: 3, col: 2 }, [
      { raw: '80.9%', label: 'MOPD average recovery' },
    ])!
    expect(f.rows.map((r) => r.split('|')[0])).toEqual([
      'Base student',
      'MOPD (TA init)',
      'P2-MOPD',
    ])
    expect(f.hi).toBe(2)
    expect(f.value).toBe('94.74')
    expect(f.label).toBe('P2-MOPD · Avg. Recovery')
  })

  it('refuses a table that does not hold every compared number', () => {
    expect(focusTable(view, { row: 3, col: 2 }, [{ raw: '83.1%', label: 'MOPD' }])).toBeNull()
  })

  it('refuses rows the viewer cannot tell apart', () => {
    const twice = { ...view, rows: [...view.rows, ['P2-MOPD', '78.74', '94.85']] }
    expect(focusTable(twice, { row: 3, col: 2 }, [])).toBeNull()
  })
})
