import { describe, expect, it } from 'vitest'
import { pino } from 'pino'
import type { FeedItemDto } from '@/lib/api-types'
import { scriptedDb } from './admin/scripted-db'
import { leadWith, loadFeedResponse, toFeedDto } from './feed'
import type { RankedItem } from '@/lib/ranking'

const log = pino({ level: 'silent' })

const ranked: RankedItem = {
  id: '11111111-0000-4000-8000-000000000000',
  title: 'Bun 2',
  tldr: 'Fast.',
  topics: ['bun'],
  kind: 'repo',
  canonicalUrl: 'https://github.com/oven-sh/bun',
  score: 1,
  publishedAt: '2026-11-01T00:00:00.000Z',
  videoKey: 'v/1.mp4',
  posterKey: null,
  durationMs: 30000,
  likeCount: 2,
  liked: false,
  saved: false,
  mentions: [],
  credits: null,
}

const card = (id: string) => toFeedDto({ ...ranked, id }, 'https://m.test')

describe('toFeedDto', () => {
  it('leaves the transcript out of the feed payload', () => {
    const dto = toFeedDto(ranked, 'https://m.test')
    expect(dto).not.toHaveProperty('transcript')
    expect(dto.videoUrl).toBe('https://m.test/v/1.mp4')
  })
})

describe('leadWith', () => {
  it('puts the focus reel first without a duplicate', () => {
    const items: FeedItemDto[] = [card('a'), card('b'), card('c')]
    expect(leadWith(items, card('b')).map((it) => it.id)).toEqual(['b', 'a', 'c'])
    expect(leadWith(items, null)).toBe(items)
  })
})

describe('loadFeedResponse', () => {
  it('reads the min template setting once when a focus reel is loaded too', async () => {
    const { db, queries } = scriptedDb(() => [])
    const feed = await loadFeedResponse(db, {
      profileId: null,
      authenticated: false,
      base: 'https://m.test',
      focusId: ranked.id,
      log,
    })
    expect(feed.items).toEqual([])
    const minTemplateReads = queries.filter(
      (q) => q.sql.includes('"app_setting"') && q.parameters.includes('feed_min_template'),
    )
    expect(minTemplateReads).toHaveLength(1)
  })
})
