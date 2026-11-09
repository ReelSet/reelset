import { describe, expect, it } from 'vitest'
import { ASK_MIN_SIMILARITY, filterCitations, selectEvidence, type EvidenceChunk } from './evidence'

const chunk = (id: string, similarity: number, url = `https://x.test/${id}`): EvidenceChunk => ({
  id,
  itemId: `item-${id}`,
  text: `text ${id}`,
  title: `Title ${id}`,
  url,
  publishedAt: '2026-11-01T00:00:00.000Z',
  similarity,
})

describe('selectEvidence', () => {
  it('drops chunks below the similarity threshold and sorts best first', () => {
    const rows = [chunk('a', 0.4), chunk('b', 0.7), chunk('c', ASK_MIN_SIMILARITY), chunk('d', 0.9)]
    expect(selectEvidence(rows).map((r) => r.id)).toEqual(['d', 'b', 'c'])
  })

  it('returns nothing when no chunk clears the bar', () => {
    expect(selectEvidence([chunk('a', 0.1), chunk('b', Number.NaN)])).toEqual([])
  })

  it('caps the number of chunks', () => {
    const rows = Array.from({ length: 20 }, (_, i) => chunk(`c${i}`, 0.9 - i * 0.001))
    expect(selectEvidence(rows)).toHaveLength(12)
  })
})

describe('filterCitations', () => {
  const retrieved = [chunk('a', 0.9), chunk('b', 0.8), chunk('c', 0.7, 'https://x.test/a')]

  it('drops ids that were not retrieved', () => {
    const out = filterCitations(['a', 'ghost', 'b'], retrieved)
    expect(out.map((c) => c.chunkId)).toEqual(['a', 'b'])
  })

  it('returns title, url and date for each citation', () => {
    expect(filterCitations(['a'], retrieved)[0]).toEqual({
      chunkId: 'a',
      title: 'Title a',
      url: 'https://x.test/a',
      publishedAt: '2026-11-01T00:00:00.000Z',
    })
  })

  it('dedupes repeated ids and chunks that share a url', () => {
    expect(filterCitations(['a', 'a', 'c'], retrieved).map((c) => c.chunkId)).toEqual(['a'])
  })

  it('returns nothing for an empty or fully invalid list', () => {
    expect(filterCitations([], retrieved)).toEqual([])
    expect(filterCitations(['x', 'y'], retrieved)).toEqual([])
  })
})
