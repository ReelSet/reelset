import { describe, expect, it } from 'vitest'
import {
  asSeenOn,
  buildShelves,
  clockDuration,
  filterHref,
  relatedTopics,
  sourceChips,
} from './browse'
import type { ReelSummary } from './types'

const reel = (id: string, topics: string[]): ReelSummary => ({
  id: `${id}0000000-0000-0000-0000-000000000000`,
  title: `Reel ${id}`,
  tldr: null,
  topics,
  publishedAt: '2026-11-10T00:00:00.000Z',
  updatedAt: '2026-11-11T00:00:00.000Z',
  videoUrl: null,
  posterUrl: null,
  durationMs: null,
})

describe('sourceChips', () => {
  it('starts with All and lists sources with reels in a fixed order', () => {
    const chips = sourceChips({
      path: '/t/ai',
      total: 9,
      counts: [
        { source: 'reddit', count: 2 },
        { source: 'hn', count: 5 },
        { source: 'papers', count: 0 },
      ],
      active: 'reddit',
    })
    expect(chips.map((c) => [c.source, c.count, c.active, c.href])).toEqual([
      [null, 9, false, '/t/ai'],
      ['hn', 5, false, '/t/ai?source=hn'],
      ['reddit', 2, true, '/t/ai?source=reddit'],
    ])
  })

  it('keeps the active source visible even with no reels', () => {
    const chips = sourceChips({ path: '/t', total: 0, counts: [], active: 'papers' })
    expect(chips.map((c) => c.source)).toEqual([null, 'papers'])
  })
})

describe('buildShelves', () => {
  it('fills a row per topic in topic order and skips thin topics', () => {
    const reels = [reel('1', ['AI', 'rust']), reel('2', ['ai']), reel('3', ['Go'])]
    const shelves = buildShelves(
      reels,
      [
        { slug: 'ai', label: 'AI', count: 9 },
        { slug: 'go', label: 'Go', count: 5 },
        { slug: 'rust', label: 'Rust', count: 4 },
      ],
      { shelves: 5, perShelf: 1, minReels: 1 },
    )
    expect(shelves.map((s) => [s.topic.slug, s.reels.map((r) => r.title)])).toEqual([
      ['ai', ['Reel 1']],
      ['go', ['Reel 3']],
      ['rust', ['Reel 1']],
    ])
    expect(
      buildShelves(reels, [{ slug: 'go', label: 'Go', count: 5 }], {
        shelves: 5,
        perShelf: 5,
        minReels: 2,
      }),
    ).toEqual([])
  })
})

describe('relatedTopics', () => {
  it('counts co-occurring topics once per reel, excluding the current one', () => {
    const related = relatedTopics(
      [reel('1', ['AI', 'agents', 'Agents']), reel('2', ['ai', 'agents', 'rust'])],
      'ai',
      5,
    )
    expect(related).toEqual([
      { slug: 'agents', label: 'Agents', count: 2 },
      { slug: 'rust', label: 'Rust', count: 1 },
    ])
  })
})

describe('small helpers', () => {
  it('formats clock durations and filter links', () => {
    expect(clockDuration(65_400)).toBe('1:05')
    expect(clockDuration(9_000)).toBe('0:09')
    expect(clockDuration(null)).toBeNull()
    expect(filterHref('/t', null)).toBe('/t')
    expect(filterHref('/t', 'hn')).toBe('/t?source=hn')
    const r = { ...reel('1', []), source: 'hn' }
    expect(asSeenOn([r], 'reddit')[0]?.source).toBe('reddit')
    expect(asSeenOn([r], null)[0]?.source).toBe('hn')
  })
})
