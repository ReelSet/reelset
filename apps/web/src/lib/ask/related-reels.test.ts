import { describe, expect, it } from 'vitest'
import { pickRelatedReels, type ReelRow } from './related-reels'

const poster = (key: string | null) => (key ? `https://media.test/${key}` : null)
const reel = (id: string, source: string | null = 'hn'): ReelRow => ({
  id,
  title: `Reel ${id}`,
  poster_key: `p/${id}.jpg`,
  source,
})

describe('pickRelatedReels', () => {
  const chunkItems = new Map([
    ['c1', 'i1'],
    ['c2', 'i1'],
    ['c3', 'i2'],
    ['c4', 'i3'],
  ])

  it('dedupes chunks of one item and keeps citation order', () => {
    const reels = new Map([
      ['i1', reel('i1')],
      ['i2', reel('i2', 'github')],
    ])
    const out = pickRelatedReels(
      [{ chunkId: 'c3' }, { chunkId: 'c1' }, { chunkId: 'c2' }],
      chunkItems,
      reels,
      poster,
    )
    expect(out.map((r) => r.itemId)).toEqual(['i2', 'i1'])
    expect(out[0]).toMatchObject({ source: 'github', posterUrl: 'https://media.test/p/i2.jpg' })
  })

  it('skips citations whose item has no served reel', () => {
    const out = pickRelatedReels(
      [{ chunkId: 'c4' }, { chunkId: 'unknown' }],
      chunkItems,
      new Map([['i1', reel('i1')]]),
      poster,
    )
    expect(out).toEqual([])
  })

  it('caps the row and defaults the source', () => {
    const items = new Map(Array.from({ length: 12 }, (_, i) => [`c${i}`, `i${i}`]))
    const reels = new Map(Array.from({ length: 12 }, (_, i) => [`i${i}`, reel(`i${i}`, null)]))
    const out = pickRelatedReels(
      Array.from({ length: 12 }, (_, i) => ({ chunkId: `c${i}` })),
      items,
      reels,
      poster,
      5,
    )
    expect(out).toHaveLength(5)
    expect(out[0]?.source).toBe('news')
  })
})
