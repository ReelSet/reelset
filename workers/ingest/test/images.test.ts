import { describe, expect, it } from 'vitest'
import { createLogger } from '@reelset/core'
import {
  captureItemImages,
  extractArxivFigures,
  extractInlineImages,
  extractMetaImages,
  extractReadmeImages,
  isJunkImage,
  mergeImages,
  normalizeImageUrl,
  type ImageFetchers,
} from '../src/images'

const log = createLogger({ app: 'test', level: 'silent' })

const ARTICLE = `<html><head>
<meta property="og:image" content="//cdn.example.com/hero.jpg?w=1200&amp;h=630">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta property="og:image:alt" content="A hero">
<meta name="twitter:image" content="https://cdn.example.com/tw.jpg"></head>
<body><header><img src="/nav-logo.png" width="900"></header>
<article>
<img src="/img/pixel.gif" width="1" height="1">
<figure><img src="/img/chart.png" width="900" height="500" alt="x"><figcaption>Latency <b>by region</b></figcaption></figure>
<img data-src="https://cdn.example.com/lazy.webp" width="800">
<img srcset="/a-400.jpg 400w, /a-1600.jpg 1600w" src="/a-400.jpg" alt="big">
<img src="https://img.shields.io/badge/x-y-green.svg">
<img src="/small.png" width="120" height="90">
</article></body></html>`

describe('extractMetaImages', () => {
  it('reads og:image with size, alt, and protocol-relative urls', () => {
    expect(extractMetaImages(ARTICLE, 'https://example.com/post')).toEqual([
      {
        url: 'https://cdn.example.com/hero.jpg?w=1200&h=630',
        kind: 'og',
        width: 1200,
        height: 630,
        alt: 'A hero',
      },
    ])
  })

  it('falls back to twitter:image and drops junk', () => {
    const html = '<meta name="twitter:image" content="https://x.com/logo.png">'
    expect(extractMetaImages(html, 'https://x.com')).toEqual([])
    const ok = '<meta name="twitter:image" content="http://x.com/a/pic.jpg">'
    expect(extractMetaImages(ok, 'https://x.com')[0]?.url).toBe('https://x.com/a/pic.jpg')
  })
})

describe('extractInlineImages', () => {
  it('keeps big in-article images, figures first, uses captions and srcset', () => {
    const out = extractInlineImages(ARTICLE, 'https://example.com/post')
    expect(out.map((i) => i.url)).toEqual([
      'https://example.com/img/chart.png',
      'https://cdn.example.com/lazy.webp',
      'https://example.com/a-1600.jpg',
    ])
    expect(out[0]?.alt).toBe('Latency by region')
  })
})

describe('extractArxivFigures', () => {
  it('resolves relative figure urls and uses the figcaption', () => {
    const html = `<figure class="ltx_figure"><img src="2501.12948v1/figures/plot.png" width="357" height="230" alt="Refer to caption"><figcaption class="ltx_caption">Figure 2: AIME accuracy</figcaption></figure>
<figure class="ltx_table"><img src="t.png" width="500" height="300"></figure>
<figure><img src="x1.png" width="40" height="40"></figure>`
    expect(extractArxivFigures(html, 'https://arxiv.org/html/2501.12948v1')).toEqual([
      {
        url: 'https://arxiv.org/html/2501.12948v1/figures/plot.png',
        kind: 'figure',
        width: 357,
        height: 230,
        alt: 'Figure 2: AIME accuracy',
      },
    ])
  })
})

describe('extractReadmeImages', () => {
  it('makes raw urls, skips badges and svgs', () => {
    const md = `[![CI](https://img.shields.io/github/actions/badge.svg)](x)
![demo](docs/demo.png)
<img src="./assets/shot.png" width="800">
![logo](https://example.com/logo.svg)
![att](https://github.com/user-attachments/assets/1234-abcd)
![blob](https://github.com/o/r/blob/main/pics/a.png?raw=true)`
    expect(extractReadmeImages(md, 'o', 'r').map((i) => i.url)).toEqual([
      'https://raw.githubusercontent.com/o/r/HEAD/docs/demo.png',
      'https://github.com/user-attachments/assets/1234-abcd',
      'https://raw.githubusercontent.com/o/r/main/pics/a.png',
      'https://raw.githubusercontent.com/o/r/HEAD/assets/shot.png',
    ])
  })
})

describe('junk and merge', () => {
  it('filters tiny, extreme-aspect, tracking and badge images', () => {
    expect(isJunkImage('https://a.com/p.jpg', 100, 100)).toBe(true)
    expect(isJunkImage('https://a.com/p.jpg', 2000, 100)).toBe(true)
    expect(isJunkImage('https://a.com/icon.svg')).toBe(true)
    expect(isJunkImage('https://a.com/photo.jpg', 800, 600)).toBe(false)
    expect(normalizeImageUrl('data:image/png;base64,AAA', 'https://a.com')).toBeNull()
  })

  it('orders hero kinds first, dedupes and caps at 6', () => {
    const figs = Array.from({ length: 8 }, (_, i) => ({
      url: `https://a.com/${i}.jpg`,
      kind: 'figure' as const,
    }))
    const og = { url: 'https://a.com/og.jpg', kind: 'og' as const }
    const out = mergeImages([figs, [og, figs[0]!]])
    expect(out).toHaveLength(6)
    expect(out[0]).toEqual(og)
  })
})

describe('captureItemImages', () => {
  const pages: Record<string, string> = {
    'https://github.com/o/r':
      '<meta property="og:image" content="https://repository-images.githubusercontent.com/1/abc">',
    'https://raw.githubusercontent.com/o/r/HEAD/README.md': '![d](docs/d.png)',
    'https://example.com/post': ARTICLE,
  }
  const fetchers = (maxres: boolean): ImageFetchers => ({
    page: async (url) => (pages[url] ? { text: pages[url]!, url } : null),
    head: async () => maxres,
    json: async () => ({ data: [{ id: 'abc', url: 'https://i.redd.it/x.jpeg' }] }),
  })

  it('youtube uses maxres when present, hq otherwise', async () => {
    const a = await captureItemImages(
      { canonicalKey: 'youtube:abcdefghijk', canonicalUrl: 'u', mentionUrls: [] },
      { log, fetchers: fetchers(true) },
    )
    expect(a[0]?.url).toContain('maxresdefault')
    const b = await captureItemImages(
      { canonicalKey: 'youtube:abcdefghijk', canonicalUrl: 'u', mentionUrls: [] },
      { log, fetchers: fetchers(false) },
    )
    expect(b[0]?.url).toContain('hqdefault')
  })

  it('github combines the repo social image and README images', async () => {
    const out = await captureItemImages(
      { canonicalKey: 'github:o/r', canonicalUrl: 'https://github.com/o/r', mentionUrls: [] },
      { log, fetchers: fetchers(true) },
    )
    expect(out.map((i) => i.kind)).toEqual(['og', 'figure'])
  })

  it('articles use og plus inline images; reddit uses i.redd.it', async () => {
    const article = await captureItemImages(
      {
        canonicalKey: 'https://example.com/post',
        canonicalUrl: 'https://example.com/post',
        mentionUrls: [],
      },
      { log, fetchers: fetchers(true) },
    )
    expect(article[0]?.kind).toBe('og')
    expect(article.length).toBeGreaterThan(2)
    const reddit = await captureItemImages(
      { canonicalKey: 'reddit:abc', canonicalUrl: 'u', mentionUrls: [] },
      { log, fetchers: fetchers(true) },
    )
    expect(reddit).toEqual([{ url: 'https://i.redd.it/x.jpeg', kind: 'figure' }])
  })

  it('never throws when fetches fail', async () => {
    const boom: ImageFetchers = {
      page: async () => {
        throw new Error('net')
      },
      head: async () => {
        throw new Error('net')
      },
      json: async () => {
        throw new Error('net')
      },
    }
    const out = await captureItemImages(
      {
        canonicalKey: 'https://example.com/post',
        canonicalUrl: 'https://example.com/post',
        mentionUrls: [],
      },
      { log, fetchers: boom },
    )
    expect(out).toEqual([])
  })
})
