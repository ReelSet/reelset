import { describe, expect, it } from 'vitest'
import { decodeHistoryCursor, deleteBodySchema, encodeHistoryCursor, groupByDay } from './history'

const KEY = '3f2b1a0c-5d6e-4f70-8a91-b2c3d4e5f607'

describe('history cursor', () => {
  it('round trips', () => {
    const cursor = { at: '2026-11-09T10:00:00.000Z', key: KEY }
    expect(decodeHistoryCursor(encodeHistoryCursor(cursor))).toEqual(cursor)
  })

  it('rejects garbage and tampered values', () => {
    expect(decodeHistoryCursor('not-base64-json')).toBeNull()
    expect(decodeHistoryCursor(null)).toBeNull()
    const bad = Buffer.from(JSON.stringify({ at: 'x', key: "1'; drop table" })).toString(
      'base64url',
    )
    expect(decodeHistoryCursor(bad)).toBeNull()
  })
})

describe('deleteBodySchema', () => {
  it('requires a uuid', () => {
    expect(deleteBodySchema.safeParse({ id: KEY }).success).toBe(true)
    expect(deleteBodySchema.safeParse({ id: '1 or 1=1' }).success).toBe(false)
  })
})

describe('groupByDay', () => {
  const now = new Date(2026, 10, 9, 15, 0)
  const at = (d: number, h: number) => ({ lastAt: new Date(2026, 10, d, h).toISOString() })

  it('groups newest-first entries into consecutive day sections', () => {
    const sections = groupByDay([at(9, 14), at(9, 9), at(8, 20), at(1, 8)], now)
    expect(sections.map((s) => s.entries.length)).toEqual([2, 1, 1])
    expect(sections[0]?.label).toBe('Today')
    expect(sections[1]?.label).toBe('Yesterday')
  })

  it('returns no sections for no entries', () => {
    expect(groupByDay([], now)).toEqual([])
  })
})
