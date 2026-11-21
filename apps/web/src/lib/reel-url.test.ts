import { describe, expect, it } from 'vitest'
import {
  reelRewritePath,
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
  it('keeps the topic and source so the reel feed stays filtered', () => {
    expect(reelHref({ id: ID, title: 'Hi' }, { source: 'hn' })).toBe('/r/hi-e86d24f7?source=hn')
    expect(reelHref({ id: ID, title: 'Hi' }, { topic: 'ai', source: 'github' })).toBe(
      '/r/hi-e86d24f7?topic=ai&source=github',
    )
    expect(reelHref({ id: ID, title: 'Hi' }, { topic: 'build-tools' })).toBe(
      '/r/hi-e86d24f7?topic=build-tools',
    )
    expect(reelHref({ id: ID, title: 'Hi' })).toBe('/r/hi-e86d24f7')
    expect(reelHref({ id: ID, title: 'Hi' }, { topic: null, source: null })).toBe('/r/hi-e86d24f7')
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

describe('reelRewritePath', () => {
  it('serves every slug spelling and the uuid from the short id', () => {
    expect(reelRewritePath('/r/some-title-1a2b3c4d')).toEqual({
      kind: 'rewrite',
      pathname: '/r/1a2b3c4d',
    })
    expect(reelRewritePath('/r/made-up-junk-1a2b3c4d')).toEqual({
      kind: 'rewrite',
      pathname: '/r/1a2b3c4d',
    })
    expect(reelRewritePath('/r/1A2B3C4D')).toEqual({ kind: 'rewrite', pathname: '/r/1a2b3c4d' })
    expect(reelRewritePath('/r/1a2b3c4d-0000-4000-8000-000000000000')).toEqual({
      kind: 'rewrite',
      pathname: '/r/1a2b3c4d',
    })
  })

  it('keeps the opengraph image suffix', () => {
    expect(reelRewritePath('/r/some-title-1a2b3c4d/opengraph-image')).toEqual({
      kind: 'rewrite',
      pathname: '/r/1a2b3c4d/opengraph-image',
    })
  })

  it('leaves the short id path itself and other paths alone', () => {
    expect(reelRewritePath('/r/1a2b3c4d')).toBeNull()
    expect(reelRewritePath('/r/1a2b3c4d/opengraph-image')).toBeNull()
    expect(reelRewritePath('/t/rust')).toBeNull()
  })

  it('rejects params that cannot name a reel', () => {
    expect(reelRewritePath('/r/not-a-reel')).toEqual({ kind: 'not_found' })
    expect(reelRewritePath('/r/%E0%A4%A')).toEqual({ kind: 'not_found' })
  })
})
