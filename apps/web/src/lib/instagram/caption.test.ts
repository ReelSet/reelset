import { describe, expect, it } from 'vitest'
import {
  buildCaption,
  checkCaption,
  countHashtags,
  topicHashtags,
  validateQueueRequest,
  VIDEO_KEY_MAX_CHARS,
} from './caption'

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
    expect(checkCaption(caption).errors).toEqual([])
  })
})

describe('hashtags', () => {
  it('sanitizes, dedupes and limits topics', () => {
    expect(
      topicHashtags(['AI/ML', 'ai ml', 'c++', 'a', 'one', 'two', 'three', 'four', 'five']),
    ).toEqual(['#aiml', '#one', '#two', '#three', '#four'])
  })

  it('counts unicode hashtags', () => {
    expect(countHashtags('#a #b_c text #é9 not# #')).toBe(3)
  })
})

describe('checkCaption', () => {
  it('flags empty, too long and too many hashtags', () => {
    expect(checkCaption('').errors).toContain('Caption is empty')
    expect(checkCaption('x'.repeat(2201)).errors[0]).toMatch(/1 characters over/)
    expect(
      checkCaption(Array.from({ length: 31 }, (_, i) => `#t${i}`).join(' ')).errors[0],
    ).toMatch(/31 hashtags/)
  })

  it('accepts a caption at exactly the limits', () => {
    expect(checkCaption('x'.repeat(2200)).errors).toEqual([])
    expect(checkCaption(Array.from({ length: 30 }, (_, i) => `#t${i}`).join(' ')).errors).toEqual(
      [],
    )
  })

  it('counts emoji as one character each', () => {
    expect(checkCaption('🔥'.repeat(2200)).errors).toEqual([])
  })
})

describe('validateQueueRequest', () => {
  const itemId = '0b5d2f3e-6a1c-4e0b-9a55-1c2d3e4f5a6b'
  const videoKey = `reels/${itemId}/abc.mp4`
  it('normalizes and accepts a valid request', () => {
    expect(validateQueueRequest({ itemId, videoKey, caption: '  hi\r\nthere ' })).toEqual({
      ok: true,
      itemId,
      videoKey,
      caption: 'hi\nthere',
    })
  })

  it('rejects bad ids, empty and oversize captions', () => {
    const bad = [
      { itemId: 'x', videoKey, caption: 'hi' },
      { itemId, videoKey, caption: '   ' },
      { itemId, videoKey, caption: 'x'.repeat(2201) },
      null,
    ]
    for (const raw of bad) expect(validateQueueRequest(raw)).toMatchObject({ ok: false })
  })

  it('requires the video key of the previewed render', () => {
    for (const key of [undefined, '', 'k'.repeat(VIDEO_KEY_MAX_CHARS + 1)]) {
      expect(validateQueueRequest({ itemId, videoKey: key, caption: 'hi' })).toMatchObject({
        ok: false,
      })
    }
  })
})
