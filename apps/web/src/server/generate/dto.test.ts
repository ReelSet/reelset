import type { ReelRequestRow } from '@reelset/core'
import { describe, expect, it } from 'vitest'
import { buildCreditsDto, buildReelRequestDto, pickRender } from './dto'

const row = {
  id: 'r1',
  user_id: 'u1',
  urls: ['https://a.com'],
  status: 'done',
  item_id: '11111111-2222-3333-4444-555555555555',
  error: null,
  credits_charged: 0,
  refunded: false,
  via: 'web',
  created_at: new Date('2026-11-15T10:00:00Z'),
  updated_at: new Date(),
} as ReelRequestRow

describe('buildReelRequestDto', () => {
  it('builds an instantly done dto with media urls and an absolute page url', () => {
    const dto = buildReelRequestDto(
      row,
      {
        item: {
          id: row.item_id as string,
          title: 'Cool repo',
          status: 'rendered',
          visibility: 'public',
          owner_id: 'u1',
          publish_review: null,
          publish_requested_at: null,
          publish_reviewed_at: null,
          publish_note: null,
        },
        render: {
          status: 'done',
          video_key: 'reels/a.mp4',
          poster_key: 'reels/a.jpg',
          video_duration_ms: 55000,
          finished_at: new Date(),
        },
        events: [],
        aheadOfYou: 3,
      },
      'https://media.test/',
    )
    expect(dto.steps.every((s) => s.state === 'done')).toBe(true)
    expect(dto.aheadOfYou).toBeNull()
    expect(dto.reel).toMatchObject({
      videoUrl: 'https://media.test/reels/a.mp4',
      posterUrl: 'https://media.test/reels/a.jpg',
      durationMs: 55000,
      visibility: 'public',
    })
    expect(dto.reel?.pageUrl).toMatch(/^https:\/\/reelset\.app\/r\/cool-repo-11111111$/)
  })

  it('keeps position and hides media while processing', () => {
    const dto = buildReelRequestDto(
      { ...row, status: 'processing' },
      {
        item: {
          id: row.item_id as string,
          title: 'X',
          status: 'summarized',
          visibility: 'private',
          owner_id: 'u1',
          publish_review: null,
          publish_requested_at: null,
          publish_reviewed_at: null,
          publish_note: null,
        },
        render: null,
        events: [],
        aheadOfYou: 2,
      },
      'https://media.test',
    )
    expect(dto.aheadOfYou).toBe(2)
    expect(dto.reel?.videoUrl).toBeNull()
    expect(dto.reel?.visibility).toBe('private')
  })
})

describe('buildReelRequestDto for a hidden item', () => {
  it('withholds the reel and its media', () => {
    const dto = buildReelRequestDto(
      row,
      {
        item: {
          id: row.item_id as string,
          title: 'Spam',
          status: 'rendered',
          visibility: 'hidden',
          owner_id: 'u1',
          publish_review: null,
          publish_requested_at: null,
          publish_reviewed_at: null,
          publish_note: null,
        },
        render: {
          status: 'done',
          video_key: 'reels/a.mp4',
          poster_key: null,
          video_duration_ms: 1000,
          finished_at: new Date(),
        },
        events: [],
        aheadOfYou: null,
      },
      'https://media.test/',
    )
    expect(dto.reel).toBeNull()
  })
})

describe('pickRender', () => {
  it('prefers the newest-template done render', () => {
    const base = { poster_key: null, video_duration_ms: null, created_at: new Date(0) }
    const picked = pickRender([
      { ...base, status: 'done', video_key: 'old', template_version: 1, finished_at: new Date(5) },
      { ...base, status: 'done', video_key: 'new', template_version: 2, finished_at: new Date(1) },
      { ...base, status: 'queued', video_key: null, template_version: 3, finished_at: null },
    ])
    expect(picked?.video_key).toBe('new')
  })
})

describe('buildCreditsDto', () => {
  it('shows admins the monthly allowance as unlimited', () => {
    expect(
      buildCreditsDto({
        monthlyFree: 1000,
        cost: 100,
        balance: 0,
        resetsAt: new Date('2026-12-01T00:00:00Z'),
        unlimited: true,
      }),
    ).toMatchObject({ balance: 1000, unlimited: true, reelsLeft: 10 })
  })
})
