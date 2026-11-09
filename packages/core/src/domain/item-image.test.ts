import { describe, expect, it } from 'vitest'
import { parseItemImages } from './item-image'

describe('parseItemImages', () => {
  it('keeps valid https entries and drops junk', () => {
    const out = parseItemImages([
      { url: 'https://a.com/x.jpg', kind: 'og', width: 1200, height: 630 },
      { url: 'http://a.com/y.jpg', kind: 'og' },
      { url: 'https://a.com/z.jpg', kind: 'banner' },
      'nope',
    ])
    expect(out).toEqual([{ url: 'https://a.com/x.jpg', kind: 'og', width: 1200, height: 630 }])
  })

  it('returns [] for non-arrays and caps at 6', () => {
    expect(parseItemImages(null)).toEqual([])
    const many = Array.from({ length: 9 }, (_, i) => ({
      url: `https://a.com/${i}.jpg`,
      kind: 'figure',
    }))
    expect(parseItemImages(many)).toHaveLength(6)
  })
})
