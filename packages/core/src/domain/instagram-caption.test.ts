import { describe, expect, it } from 'vitest'
import { buildCaption, parseCaptionCredits, topicHashtags } from './instagram-caption'
import { INSTAGRAM_CAPTION_MAX_CHARS } from './instagram-post'

const base = {
  title: 'Widget 2.0 released',
  hook: 'This repo just made builds 10x faster.',
  tldr: 'Widget 2.0 ships a cache.',
  canonicalUrl: 'https://github.com/acme/widget',
  topics: ['Rust', 'build tools', 'rust', 'x'],
  credits: [],
}

describe('buildCaption', () => {
  it('leads with the hook, then source, credits and hashtags', () => {
    const caption = buildCaption({
      ...base,
      credits: [
        { kind: 'stock', creator: 'Ana Lee' },
        { kind: 'stock', creator: 'Ana Lee' },
        { kind: 'demo', repo: 'acme/widget' },
      ],
    })
    expect(caption.split('\n\n')).toEqual([
      'This repo just made builds 10x faster.',
      'Source: https://github.com/acme/widget',
      'Stock video by Ana Lee on Pexels (pexels.com)\nDemo footage: github.com/acme/widget',
      '#rust #buildtools #reelset #developers',
    ])
  })

  it('falls back to tldr then title and omits empty credit blocks', () => {
    expect(buildCaption({ ...base, hook: null }).startsWith('Widget 2.0 ships a cache.')).toBe(true)
    expect(
      buildCaption({ ...base, hook: null, tldr: null }).startsWith('Widget 2.0 released'),
    ).toBe(true)
    expect(buildCaption(base)).not.toMatch(/Pexels/)
  })

  it('never exceeds the Instagram limit', () => {
    const caption = buildCaption({ ...base, hook: 'a'.repeat(3000) })
    expect(caption.length).toBeLessThanOrEqual(INSTAGRAM_CAPTION_MAX_CHARS)
  })
})

describe('topicHashtags', () => {
  it('sanitizes, dedupes and limits topics', () => {
    expect(
      topicHashtags(['AI/ML', 'ai ml', 'c++', 'a', 'one', 'two', 'three', 'four', 'five']),
    ).toEqual(['#aiml', '#one', '#two', '#three', '#four'])
  })
})

describe('parseCaptionCredits', () => {
  it('keeps valid credits and reads malformed JSON as none', () => {
    expect(parseCaptionCredits([{ kind: 'stock', creator: 'A' }, { kind: 'demo' }])).toEqual([
      { kind: 'stock', creator: 'A' },
      { kind: 'demo' },
    ])
    expect(parseCaptionCredits([{ kind: 'other' }])).toEqual([])
    expect(parseCaptionCredits(null)).toEqual([])
  })
})
