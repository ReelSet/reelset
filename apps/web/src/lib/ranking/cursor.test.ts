import { describe, expect, it } from 'vitest'
import { clampLimit, decodeCursor, encodeCursor } from './cursor'

const cursor = { asOf: '2026-11-07T10:20:30.123Z', offset: 16 }

describe('feed cursor', () => {
  it('round-trips', () => {
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor)
  })

  it('rejects garbage, wrong shapes and injected sql', () => {
    expect(decodeCursor('')).toBeNull()
    expect(decodeCursor(null)).toBeNull()
    expect(decodeCursor('not-base64-json')).toBeNull()
    const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url')
    expect(decodeCursor(enc({ v: 1, a: "2026-01-01'; drop table item;--", o: 1 }))).toBeNull()
    expect(decodeCursor(enc({ v: 1, a: cursor.asOf, o: -1 }))).toBeNull()
    expect(decodeCursor(enc({ v: 1, a: cursor.asOf, o: 1.5 }))).toBeNull()
    expect(decodeCursor(enc({ v: 2, a: cursor.asOf, o: 1 }))).toBeNull()
  })

  it('rejects legacy keyset cursors and oversized input', () => {
    const legacy = { t: '2026-11-07T10:20:30.123456Z', i: '0b5d2f3e-6a1c-4e0b-9a55-1c2d3e4f5a6b' }
    expect(decodeCursor(Buffer.from(JSON.stringify(legacy)).toString('base64url'))).toBeNull()
    expect(decodeCursor('a'.repeat(300))).toBeNull()
  })
})

describe('clampLimit', () => {
  it('defaults and clamps', () => {
    expect(clampLimit(undefined)).toBe(8)
    expect(clampLimit(Number.NaN)).toBe(8)
    expect(clampLimit(0)).toBe(1)
    expect(clampLimit(500)).toBe(24)
    expect(clampLimit(5.9)).toBe(5)
  })
})
