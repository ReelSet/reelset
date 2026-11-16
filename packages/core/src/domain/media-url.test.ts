import { describe, expect, it } from 'vitest'
import { POSTER_CACHE_VERSION, mediaKeyUrl } from './media-url'

describe('mediaKeyUrl', () => {
  it('joins base and key with a single slash', () => {
    expect(mediaKeyUrl('https://cdn.test/', '/reels/a/b.mp4')).toBe(
      'https://cdn.test/reels/a/b.mp4',
    )
    expect(mediaKeyUrl('https://cdn.test', 'papers/x/fig.png')).toBe(
      'https://cdn.test/papers/x/fig.png',
    )
  })

  it('versions reel posters so caches fetch the rewritten file', () => {
    expect(mediaKeyUrl('https://cdn.test', 'reels/i1/k.jpg')).toBe(
      `https://cdn.test/reels/i1/k.jpg?v=${POSTER_CACHE_VERSION}`,
    )
  })
})
