import { describe, expect, it } from 'vitest'
import {
  legacyReelRedirect,
  parseReelParam,
  reelHref,
  reelPath,
  shortId,
  shortIdRange,
  slugify,
  topicPath,
  topicSlug,
} from './reel-url'

const ID = 'e86d24f7-f018-4041-acee-4e0b3bf0534b'

describe('slugify', () => {
  it('makes lowercase ascii words joined by dashes', () => {
    expect(slugify('Claude Code 2.0: Rust & Go — déjà vu!')).toBe('claude-code-2-0-rust-go-deja-vu')
    expect(slugify('  ---  ')).toBe('')
    expect(slugify('日本語')).toBe('')
  })

  it('cuts long titles at a word boundary', () => {
    const slug = slugify('word '.repeat(40))
    expect(slug.length).toBeLessThanOrEqual(60)
    expect(slug.endsWith('-')).toBe(false)
    expect(slug.split('-').every((w) => w === 'word')).toBe(true)
  })
})

describe('reelPath', () => {
  it('joins the title slug and the short id', () => {
    expect(shortId(ID)).toBe('e86d24f7')
    expect(reelPath({ id: ID, title: 'Claude solved two problems' })).toBe(
      '/r/claude-solved-two-problems-e86d24f7',
    )
  })

  it('falls back to the bare short id', () => {
    expect(reelPath({ id: ID })).toBe('/r/e86d24f7')
    expect(reelPath({ id: ID, title: '日本語' })).toBe('/r/e86d24f7')
  })
})

describe('reelHref', () => {
  it('keeps the topic so the reel feed stays filtered', () => {
    expect(reelHref({ id: ID, title: 'Hi' }, 'build-tools')).toBe(
      '/r/hi-e86d24f7?topic=build-tools',
    )
    expect(reelHref({ id: ID, title: 'Hi' })).toBe('/r/hi-e86d24f7')
    expect(reelHref({ id: ID, title: 'Hi' }, null)).toBe('/r/hi-e86d24f7')
  })
})

describe('parseReelParam', () => {
  it('round-trips canonical paths', () => {
    const path = reelPath({ id: ID, title: 'Rust 2.0 is out' })
    expect(parseReelParam(path.slice(3))).toEqual({
      shortId: 'e86d24f7',
      slug: 'rust-2-0-is-out',
      id: null,
    })
  })

  it('accepts bare short ids, full uuids and encoded input', () => {
    expect(parseReelParam('e86d24f7')).toEqual({ shortId: 'e86d24f7', slug: '', id: null })
    expect(parseReelParam(ID.toUpperCase())).toEqual({ shortId: 'e86d24f7', slug: '', id: ID })
    expect(parseReelParam('hello%2Dworld-e86d24f7')?.slug).toBe('hello-world')
  })

  it('rejects anything else', () => {
    for (const bad of ['', 'e86d24f', 'title-only', 'x-e86d24fz', '%E0%A4%A', 'a/b-e86d24f7']) {
      expect(parseReelParam(bad)).toBeNull()
    }
  })
})

describe('shortIdRange', () => {
  it('brackets every uuid that starts with the short id', () => {
    const [lo, hi] = shortIdRange('e86d24f7')
    expect(lo <= ID && ID <= hi).toBe(true)
  })
})

describe('topics', () => {
  it('slugs topic labels for /t paths', () => {
    expect(topicSlug('Build Tools')).toBe('build-tools')
    expect(topicPath('C++')).toBe('/t/c')
  })
})

describe('legacyReelRedirect', () => {
  it('moves /?reel=<uuid> to the reel page and ignores everything else', () => {
    expect(legacyReelRedirect('/', ID)).toBe('/r/e86d24f7')
    expect(legacyReelRedirect('/', null)).toBeNull()
    expect(legacyReelRedirect('/', 'not-a-reel')).toBeNull()
    expect(legacyReelRedirect('/ask', ID)).toBeNull()
  })
})
