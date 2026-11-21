import { describe, expect, it } from 'vitest'
import { parseReelParam } from '@/lib/reel-url'
import { buildSitemap } from '@/lib/seo/feeds'
import { scriptedDb } from './admin/scripted-db'
import { listReelSummaries, listSitemapReels, loadOgFields } from './seo-queries'

const row = {
  id: '1a2b3c4d-0000-4000-8000-000000000000',
  title: 'Bun 2 ships',
  tldr: 'Faster installs.',
  published_at: new Date('2026-11-01T00:00:00Z'),
  updated_at: new Date('2026-11-02T00:00:00Z'),
  video_key: 'v/1.mp4',
  poster_key: 'p/1.jpg',
  video_duration_ms: 42_000,
}

describe('listSitemapReels', () => {
  it('selects no per-row mention subquery, topics or view counts', async () => {
    const { db, queries } = scriptedDb(() => [row])
    await listSitemapReels(db, 'https://m.test', 20_000)
    const sql = queries[0]!.sql
    expect(sql).not.toContain('mention')
    expect(sql).not.toContain('view_count')
    expect(sql).not.toContain('i.topics')
    expect(queries[0]!.parameters).toContain(20_000)
  })

  it('maps lean rows into sitemap entries with video metadata', async () => {
    const { db } = scriptedDb(() => [row])
    const reels = await listSitemapReels(db, 'https://m.test', 10)
    expect(reels[0]).toMatchObject({
      id: row.id,
      topics: [],
      updatedAt: '2026-11-02T00:00:00.000Z',
      posterUrl: 'https://m.test/p/1.jpg',
      videoUrl: 'https://m.test/v/1.mp4',
    })
    const map = buildSitemap({ reels, topics: [], retentionDays: 30, now: new Date() })
    const entry = map.find((e) => e.url.includes('/r/bun-2-ships-1a2b3c4d'))
    expect(entry?.videos?.[0]?.duration).toBe(42)
  })
})

describe('listReelSummaries', () => {
  it('skips the lead-source subquery when asked', async () => {
    const { db, queries } = scriptedDb(() => [])
    await listReelSummaries(db, 'https://m.test', { limit: 5, withLeadSource: false })
    await listReelSummaries(db, 'https://m.test', { limit: 5 })
    expect(queries[0]!.sql).not.toContain('from mention m')
    expect(queries[1]!.sql).toContain('from mention m')
  })
})

describe('loadOgFields', () => {
  it('reads only the card fields and prefers the matching slug', async () => {
    const { db, queries } = scriptedDb(() => [
      { title: 'Other reel', topics: ['x'], canonical_url: 'https://a.test', poster_key: null },
      {
        title: 'Bun 2 ships',
        topics: ['bun'],
        canonical_url: 'https://b.test',
        poster_key: 'p.jpg',
      },
    ])
    const og = await loadOgFields(db, parseReelParam('bun-2-ships-1a2b3c4d')!, 'https://m.test')
    expect(og).toEqual({
      title: 'Bun 2 ships',
      topics: ['bun'],
      canonicalUrl: 'https://b.test',
      posterUrl: 'https://m.test/p.jpg',
    })
    expect(queries).toHaveLength(1)
    expect(queries[0]!.sql).not.toContain('script')
    expect(queries[0]!.sql).toContain("i.visibility <> 'hidden'")
  })

  it('is null when nothing matches', async () => {
    const { db } = scriptedDb(() => [])
    expect(await loadOgFields(db, parseReelParam('1a2b3c4d')!, 'https://m.test')).toBeNull()
  })
})
