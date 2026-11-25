import { describe, expect, it, vi } from 'vitest'
import { silentLog } from '../testing'
import type { Logger } from '@reelset/core'
import { queueAutoInstagramPosts, type AutoCandidate, type AutoPostDeps } from './auto'

const TITLES: Record<string, string> = {
  a: 'Rust compiler gets faster incremental builds',
  b: 'Postgres adds native vector search',
}

const candidate = (id: string, over: Partial<AutoCandidate> = {}): AutoCandidate => ({
  id,
  title: TITLES[id] ?? `Headline about ${id}`,
  tldr: null,
  topics: ['rust'],
  canonical_url: `https://example.com/${id}`,
  hook: `Hook ${id}`,
  video_key: `reels/${id}/v.mp4`,
  credits: [{ kind: 'stock', creator: 'Ana' }],
  ...over,
})

function deps(over: Partial<AutoPostDeps> = {}) {
  const inserted: { itemId: string; videoKey: string; caption: string }[] = []
  const d: AutoPostDeps = {
    enabled: async () => true,
    requireGatePass: async () => false,
    dailyLimit: async () => 2,
    queuedToday: async () => 0,
    candidates: vi.fn(async (limit: number, _opts: { requireGatePass: boolean }) =>
      [candidate('a'), candidate('b')].slice(0, limit),
    ),
    recentPosts: async () => [],
    insert: async (post) => {
      inserted.push(post)
      return true
    },
    ...over,
  }
  return { d, inserted }
}

describe('queueAutoInstagramPosts', () => {
  it('queues new reels with the composer caption, up to the daily cap', async () => {
    const { d, inserted } = deps()
    expect(await queueAutoInstagramPosts(d, silentLog)).toBe(2)
    expect(d.candidates).toHaveBeenCalledWith(2, { requireGatePass: false })
    expect(inserted.map((p) => p.itemId)).toEqual(['a', 'b'])
    expect(inserted[0]).toMatchObject({ videoKey: 'reels/a/v.mp4' })
    expect(inserted[0]!.caption.split('\n\n')).toEqual([
      'Hook a',
      'Source: https://example.com/a',
      'Stock video by Ana on Pexels (pexels.com)',
      '#rust #reelset #developers',
    ])
  })

  it('only fills what is left of today', async () => {
    const { d, inserted } = deps({ dailyLimit: async () => 2, queuedToday: async () => 1 })
    expect(await queueAutoInstagramPosts(d, silentLog)).toBe(1)
    expect(d.candidates).toHaveBeenCalledWith(1, { requireGatePass: false })
    expect(inserted).toHaveLength(1)
  })

  it('does nothing when switched off or the cap is used up', async () => {
    for (const over of [
      { enabled: async () => false },
      { queuedToday: async () => 2 },
      { dailyLimit: async () => 1, queuedToday: async () => 5 },
    ] satisfies Partial<AutoPostDeps>[]) {
      const { d, inserted } = deps(over)
      expect(await queueAutoInstagramPosts(d, silentLog)).toBe(0)
      expect(d.candidates).not.toHaveBeenCalled()
      expect(inserted).toEqual([])
    }
  })

  it('does not count a reel that was already queued', async () => {
    const { d } = deps({ insert: async (p) => p.itemId !== 'a' })
    expect(await queueAutoInstagramPosts(d, silentLog)).toBe(1)
  })

  it('asks only for gate-passed reels when the gate setting is on', async () => {
    const { d, inserted } = deps({ requireGatePass: async () => true })
    expect(await queueAutoInstagramPosts(d, silentLog)).toBe(2)
    expect(d.candidates).toHaveBeenCalledWith(2, { requireGatePass: true })
    expect(inserted).toHaveLength(2)
  })

  describe('duplicate stories', () => {
    const posted = [{ item_id: 'old', title: 'Nvidia reports record data center revenue in Q3' }]

    it('skips a candidate that tells the same story as a recent post and says why', async () => {
      const { d, inserted } = deps({
        recentPosts: async () => posted,
        candidates: vi.fn(async () => [
          candidate('dup', { title: 'Nvidia reports record data center revenue for Q3' }),
          candidate('b'),
        ]),
      })
      const debug = vi.fn()
      const log = { child: () => ({ debug, info: vi.fn() }) } as unknown as Logger
      expect(await queueAutoInstagramPosts(d, log)).toBe(1)
      expect(inserted.map((p) => p.itemId)).toEqual(['b'])
      expect(debug).toHaveBeenCalledWith(
        { itemId: 'dup', duplicateOf: 'old' },
        'duplicate story, not queued',
      )
    })

    it('looks back 72 hours', async () => {
      const recentPosts = vi.fn(async () => posted)
      const { d } = deps({ recentPosts })
      await queueAutoInstagramPosts(d, silentLog)
      expect(recentPosts).toHaveBeenCalledWith(72)
    })

    it('admits only the first of two duplicates arriving in the same run', async () => {
      const { d, inserted } = deps({
        candidates: vi.fn(async () => [
          candidate('x1', { title: 'OpenAI ships GPT-6 with native video' }),
          candidate('x2', { title: 'OpenAI ships GPT-6 with native video support' }),
        ]),
      })
      expect(await queueAutoInstagramPosts(d, silentLog)).toBe(1)
      expect(inserted.map((p) => p.itemId)).toEqual(['x1'])
    })

    it('does not skip a different story', async () => {
      const { d, inserted } = deps({ recentPosts: async () => posted })
      expect(await queueAutoInstagramPosts(d, silentLog)).toBe(2)
      expect(inserted).toHaveLength(2)
    })
  })
})
