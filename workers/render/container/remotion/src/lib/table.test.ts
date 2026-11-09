import { describe, expect, it } from 'vitest'
import { columnWidths, fitLabel, holdFor, readTable, rowHeight } from './table'

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
