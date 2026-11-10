import { describe, expect, it } from 'vitest'
import { CONTAINER_USD_PER_SECOND } from './constants'
import { RenderJobError } from './errors'
import { containerJobId, posterKeyFor, videoKeyFor } from './keys'
import {
  upgradeBatchSize,
  classifyFailure,
  collectImageUrls,
  deadLetterGrowing,
  decideRenderAction,
  failureRateExceeded,
  findOrphanKeys,
  primarySource,
  prioritizeUpgrades,
  renderCostUsd,
  retentionCutoff,
  sourceImageUrls,
  sourceLabel,
  stuckCutoff,
  youtubeVideoId,
} from './plan'
import { validScript } from './testing'
import type { ReelScript } from '@reelset/core'

describe('keys', () => {
  it('builds r2 keys per contract', () => {
    expect(videoKeyFor('item-1', 'abc')).toBe('reels/item-1/abc.mp4')
    expect(posterKeyFor('item-1', 'abc')).toBe('reels/item-1/abc.jpg')
  })

  it('derives a container job id that satisfies the container validator', () => {
    const id = containerJobId('a'.repeat(64))
    expect(id).toMatch(/^[A-Za-z0-9_-]{8,80}$/)
  })
})

describe('decideRenderAction', () => {
  const done = { status: 'done', videoKey: 'v', posterKey: 'p' } as const

  it('renders already rendered items again (template upgrade)', () => {
    expect(decideRenderAction('rendered', null)).toEqual({ kind: 'render' })
    expect(decideRenderAction('rendered', done)).toEqual({ kind: 'finish' })
  })

  it('renders fresh embedded and voiced items', () => {
    expect(decideRenderAction('embedded', null)).toEqual({ kind: 'render' })
    expect(
      decideRenderAction('voiced', { status: 'rendering', videoKey: null, posterKey: null }),
    ).toEqual({
      kind: 'render',
    })
  })

  it('finishes when a done render with keys exists', () => {
    expect(decideRenderAction('embedded', done)).toEqual({ kind: 'finish' })
    expect(decideRenderAction('voiced', done)).toEqual({ kind: 'finish' })
  })

  it('treats a done render without keys (retention cleared) as needing a render', () => {
    expect(
      decideRenderAction('embedded', { status: 'done', videoKey: null, posterKey: null }),
    ).toEqual({
      kind: 'render',
    })
  })

  it('skips every other item status', () => {
    for (const s of ['found', 'summarized', 'failed', 'insufficient_source'] as const) {
      expect(decideRenderAction(s, null).kind).toBe('skip')
    }
  })
})

describe('classifyFailure', () => {
  it('retries transient errors until the last attempt', () => {
    const err = new RenderJobError('tts_unavailable')
    expect(classifyFailure(err, 1)).toMatchObject({
      terminal: false,
      deadLetter: false,
      retryDelaySeconds: 30,
    })
    expect(classifyFailure(err, 3)).toMatchObject({ terminal: false })
    expect(classifyFailure(err, 4)).toMatchObject({ terminal: true, deadLetter: true })
  })

  it('retries container_unreachable longer with capped exponential backoff', () => {
    const err = new RenderJobError('container_unreachable')
    const delays = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => classifyFailure(err, n))
    expect(delays.every((d) => !d.terminal)).toBe(true)
    expect(delays.map((d) => d.retryDelaySeconds)).toEqual([30, 60, 120, 240, 300, 300, 300, 300])
    expect(classifyFailure(err, 9)).toMatchObject({ terminal: true, deadLetter: true })
  })

  it('fails permanent errors immediately without dead-lettering', () => {
    expect(classifyFailure(new RenderJobError('invalid_input'), 1)).toMatchObject({
      terminal: true,
      deadLetter: false,
    })
    expect(classifyFailure(new RenderJobError('too_large'), 2).terminal).toBe(true)
  })

  it('treats unknown errors as retryable container failures', () => {
    expect(classifyFailure(new Error('boom'), 1)).toMatchObject({
      code: 'container_unreachable',
      terminal: false,
    })
  })
})

describe('cost and labels', () => {
  it('prices render seconds from container rates', () => {
    expect(renderCostUsd(0)).toBe(0)
    expect(renderCostUsd(60)).toBeCloseTo(60 * CONTAINER_USD_PER_SECOND, 5)
    expect(renderCostUsd(-5)).toBe(0)
  })

  it('labels sources', () => {
    expect(sourceLabel('hn')).toBe('Hacker News')
    expect(sourceLabel(null)).toBe('Dev')
  })

  it('collects unique https image urls from beats', () => {
    const script = {
      ...validScript,
      beats: [
        ...validScript.beats,
        { text: 'again', visual: { type: 'image', url: 'https://i.ytimg.com/vi/x/hq.jpg' } },
        { text: 'plain', visual: { type: 'image', url: 'http://i.ytimg.com/insecure.jpg' } },
      ],
    } as unknown as ReelScript
    expect(collectImageUrls(script)).toEqual(['https://i.ytimg.com/vi/x/hq.jpg'])
  })
})

describe('maintenance decisions', () => {
  const now = new Date('2026-11-09T12:00:00Z')

  it('computes cutoffs', () => {
    expect(stuckCutoff(now, 20).toISOString()).toBe('2026-11-09T11:40:00.000Z')
    expect(retentionCutoff(now, 30).toISOString()).toBe('2026-10-10T12:00:00.000Z')
  })

  it('flags only old objects that have no done render', () => {
    const old = new Date('2026-11-07T00:00:00Z')
    const fresh = new Date('2026-11-09T11:00:00Z')
    const objects = [
      { key: 'reels/a/1.mp4', uploaded: old },
      { key: 'reels/a/1.jpg', uploaded: old },
      { key: 'reels/b/2.mp4', uploaded: old },
      { key: 'reels/c/3.mp4', uploaded: fresh },
    ]
    const done = new Set(['reels/a/1.mp4', 'reels/a/1.jpg'])
    expect(findOrphanKeys(objects, done, now)).toEqual(['reels/b/2.mp4'])
  })

  it('failure rate needs at least 5 renders and more than 20% failed', () => {
    expect(failureRateExceeded({ total: 4, failed: 4 })).toBe(false)
    expect(failureRateExceeded({ total: 10, failed: 2 })).toBe(false)
    expect(failureRateExceeded({ total: 10, failed: 3 })).toBe(true)
    expect(failureRateExceeded({ total: 5, failed: 2 })).toBe(true)
    expect(failureRateExceeded({ total: 0, failed: 0 })).toBe(false)
  })

  it('dead letter growth threshold', () => {
    expect(deadLetterGrowing(2)).toBe(false)
    expect(deadLetterGrowing(3)).toBe(true)
  })
})

describe('sourceImageUrls', () => {
  it('derives the github social preview from the canonical or mention url', () => {
    expect(sourceImageUrls('github', ['https://github.com/acme/widget'])).toEqual([
      'https://opengraph.githubassets.com/1/acme/widget',
    ])
    expect(
      sourceImageUrls('github', ['https://example.com/x', 'https://github.com/a-b/c.d/issues/1']),
    ).toEqual(['https://opengraph.githubassets.com/1/a-b/c.d'])
  })

  it('derives youtube thumbnails, best first', () => {
    expect(
      sourceImageUrls('youtube', [null, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ']),
    ).toEqual([
      'https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg',
      'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    ])
    expect(youtubeVideoId('https://youtu.be/dQw4w9WgXcQ?t=3')).toBe('dQw4w9WgXcQ')
    expect(youtubeVideoId('https://youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  })

  it('returns nothing for other sources or malformed urls (the container falls back to og:image)', () => {
    expect(sourceImageUrls('hn', ['https://github.com/acme/widget'])).toEqual([])
    expect(sourceImageUrls('github', ['not a url', 'https://github.com/'])).toEqual([])
    expect(sourceImageUrls('youtube', ['https://youtube.com/watch?v=short'])).toEqual([])
    expect(sourceImageUrls(null, [])).toEqual([])
  })
})

describe('upgradeBatchSize', () => {
  const base = { target: 6, rendering: 0, pendingUpgrades: 0, pendingNew: 0, cap: 6 }

  it('fills the free in-flight slots up to the cap', () => {
    expect(upgradeBatchSize(base)).toBe(6)
    expect(upgradeBatchSize({ ...base, rendering: 2, pendingUpgrades: 1 })).toBe(3)
    expect(upgradeBatchSize({ ...base, cap: 4 })).toBe(4)
  })

  it('gives new items priority and never goes negative', () => {
    expect(upgradeBatchSize({ ...base, pendingNew: 4 })).toBe(2)
    expect(upgradeBatchSize({ ...base, pendingNew: 9 })).toBe(0)
    expect(upgradeBatchSize({ ...base, rendering: 3, pendingUpgrades: 3 })).toBe(0)
  })
})

describe('prioritizeUpgrades', () => {
  const now = new Date('2026-11-09T12:00:00Z')
  const day = 86_400_000
  const c = (id: string, score: number, ageDays: number, bestTemplate: number) => ({
    id,
    score,
    publishedAt: new Date(now.getTime() - ageDays * day),
    bestTemplate,
  })

  it('puts items hidden from the feed before visible ones', () => {
    const out = prioritizeUpgrades([c('vis', 1, 0, 5), c('hid', 0.3, 6, 1)], 5, now)
    expect(out.map((x) => x.id)).toEqual(['hid', 'vis'])
  })

  it('orders within a group by score decayed with age', () => {
    const out = prioritizeUpgrades(
      [c('old-hot', 1, 8, 1), c('new-meh', 0.5, 0.5, 1), c('new-hot', 0.9, 1, 1)],
      5,
      now,
    )
    expect(out.map((x) => x.id)).toEqual(['new-hot', 'new-meh', 'old-hot'])
  })

  it('treats everything as visible when the minimum is 0 and breaks ties by id', () => {
    const out = prioritizeUpgrades([c('b', 0.5, 1, 0), c('a', 0.5, 1, 3)], 0, now)
    expect(out.map((x) => x.id)).toEqual(['a', 'b'])
  })
})

describe('primarySource', () => {
  it('uses the canonical URL kind over the discovering mention', () => {
    expect(primarySource('reddit', 'https://github.com/shootthesound/fizgig')).toBe('github')
    expect(primarySource('hn', 'https://arxiv.org/abs/2611.03953')).toBe('papers')
    expect(primarySource('reddit', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('youtube')
  })

  it('keeps the mention source for articles and bare hosts', () => {
    expect(primarySource('hn', 'https://mailroute.net/blog/outlook')).toBe('hn')
    expect(primarySource('reddit', 'https://github.com/')).toBe('reddit')
    expect(primarySource(null, null)).toBeNull()
    expect(sourceLabel(primarySource('reddit', 'https://github.com/a/b'))).toBe('GitHub')
  })
})
