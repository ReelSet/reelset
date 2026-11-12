import { describe, expect, it, vi } from 'vitest'
import { silentLog } from '../testing'
import { queueAutoInstagramPosts, type AutoCandidate, type AutoPostDeps } from './auto'

const candidate = (id: string, over: Partial<AutoCandidate> = {}): AutoCandidate => ({
  id,
  title: `Title ${id}`,
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
    dailyLimit: async () => 2,
    queuedToday: async () => 0,
    candidates: vi.fn(async (limit: number) => [candidate('a'), candidate('b')].slice(0, limit)),
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
    expect(d.candidates).toHaveBeenCalledWith(2)
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
    expect(d.candidates).toHaveBeenCalledWith(1)
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
})
