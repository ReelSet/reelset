import { describe, expect, it } from 'vitest'
import { demoCrops, demoDecodeSize, repoIdentity, tokenRows } from './dev-layout'

const ctx = (over: object = {}) =>
  ({ facts: {}, domain: '', title: 'x', demo: undefined, ...over }) as Parameters<
    typeof repoIdentity
  >[0]

describe('repoIdentity', () => {
  it('prefers facts, then demo repo, domain, title', () => {
    expect(repoIdentity(ctx({ facts: { repo: { owner: 'a', name: 'b' } } }))).toEqual({
      owner: 'a',
      name: 'b',
    })
    expect(repoIdentity(ctx({ domain: 'github.com/o/n' }))).toEqual({ owner: 'o', name: 'n' })
    expect(repoIdentity(ctx({ title: 'foo / bar' }))).toEqual({ owner: 'foo', name: 'bar' })
    expect(repoIdentity(ctx({ title: 'Just a title' }))).toEqual({
      owner: '',
      name: 'Just a title',
    })
  })
})

describe('tokenRows', () => {
  it('wraps a long token across rows without losing text', () => {
    const rows = tokenRows([{ text: 'abcdefghij', kind: 'plain' }], 4)
    expect(rows.map((r) => r.map((t) => t.text).join(''))).toEqual(['abcd', 'efgh', 'ij'])
  })
  it('keeps kinds and fills rows across tokens', () => {
    const rows = tokenRows(
      [
        { text: 'let', kind: 'keyword' },
        { text: ' x', kind: 'plain' },
      ],
      4,
    )
    expect(rows).toHaveLength(2)
    expect(rows[0]![0]!.kind).toBe('keyword')
  })
  it('returns one empty row for an empty line', () => {
    expect(tokenRows([], 10)).toEqual([[]])
  })
})

describe('demoCrops', () => {
  it('covers the window on both cuts and zooms closer on the second', () => {
    const [a, b] = demoCrops({ width: 1280, height: 720 }, 833, 1000)
    for (const p of [a, b]) {
      expect(p.videoWidth).toBeGreaterThanOrEqual(833)
      expect(p.videoHeight).toBeGreaterThanOrEqual(1000)
      expect(p.from.x).toBeLessThanOrEqual(0)
    }
    expect(b.videoWidth).toBeGreaterThan(a.videoWidth)
  })
})

describe('demoDecodeSize', () => {
  it('keeps small demos as they are and caps big ones', () => {
    expect(demoDecodeSize({ width: 800, height: 450 })).toEqual({ w: 800, h: 450 })
    const big = demoDecodeSize({ width: 3840, height: 2160 })
    expect(big.w).toBe(1280)
    expect(big.h).toBe(720)
  })
})
