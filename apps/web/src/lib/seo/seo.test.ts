import { describe, expect, it } from 'vitest'
import { resolveSitemap } from 'next/dist/build/webpack/loaders/metadata/resolve-route-data'
import {
  buildLlmsFullTxt,
  buildLlmsTxt,
  buildSitemap,
  groupTopics,
  indexedTopics,
  xmlText,
} from './feeds'
import { jsonLdHtml, reelJsonLd, siteJsonLd, topicJsonLd } from './json-ld'
import { scriptParts } from './script'
import { absoluteUrl, isoDuration, metaDescription, metaTitle, topicLabel } from './site'
import type { ReelPageData, ReelSummary } from './types'

const ID = 'e86d24f7-f018-4041-acee-4e0b3bf0534b'

const reel: ReelPageData = {
  id: ID,
  title: 'Claude solved two unsolved problems',
  tldr: 'A model closed two open problems in black-hole physics.',
  hook: 'Two open problems, closed.',
  transcript: 'Two open problems, closed. Here is how.',
  topics: ['AI', 'Physics'],
  kind: 'news',
  canonicalUrl: 'https://example.com/story',
  publishedAt: '2026-11-11T10:00:00.000Z',
  renderedAt: '2026-11-11T10:33:55.000Z',
  videoUrl: 'https://media.reelset.app/reels/v.mp4',
  posterUrl: 'https://media.reelset.app/reels/p.jpg',
  durationMs: 65_400,
  facts: [{ text: 'It took 3 days.', sources: [{ url: 'https://arxiv.org/x', title: 'Paper' }] }],
  mentions: [
    {
      source: 'hn',
      url: 'https://news.ycombinator.com/item?id=1',
      title: 'Discussion',
      author: null,
      score: 120,
      comments: 40,
    },
  ],
}

const summary = (id: string, over: Partial<ReelSummary> = {}): ReelSummary => ({
  id,
  title: `Reel ${id.slice(0, 2)}`,
  tldr: 'Short summary.',
  topics: ['AI'],
  publishedAt: '2026-11-10T00:00:00.000Z',
  updatedAt: '2026-11-11T00:00:00.000Z',
  videoUrl: 'https://m/v.mp4',
  posterUrl: 'https://m/p.jpg',
  durationMs: 60_000,
  ...over,
})

describe('site helpers', () => {
  it('formats ISO durations', () => {
    expect(isoDuration(65_400)).toBe('PT1M5S')
    expect(isoDuration(60_000)).toBe('PT1M')
    expect(isoDuration(9_000)).toBe('PT9S')
    expect(isoDuration(null)).toBeUndefined()
  })

  it('picks the first non-empty description and trims it to 160 chars at a word', () => {
    expect(metaDescription(null, '  ', 'Hello  world')).toBe('Hello world')
    const long = metaDescription('word '.repeat(60))
    expect(long.length).toBeLessThanOrEqual(160)
    expect(long.endsWith('…')).toBe(true)
  })

  it('keeps meta titles short, preferring the first clause', () => {
    expect(metaTitle('Short title')).toBe('Short title')
    const reddit =
      'Claude solved two unsolved problems in black-hole physics: settling a 23-year-old question'
    expect(metaTitle(reddit)).toBe('Claude solved two unsolved problems in black-hole physics')
    const long = metaTitle('word '.repeat(30))
    expect(long.length).toBeLessThanOrEqual(65)
    expect(long.endsWith('…')).toBe(true)
  })

  it('shows topic tags in title case with known acronyms', () => {
    expect(topicLabel('ai agents')).toBe('AI Agents')
    expect(topicLabel('claude code')).toBe('Claude Code')
    expect(topicLabel('macos')).toBe('macOS')
    expect(topicLabel('WebGPU')).toBe('WebGPU')
    expect(topicLabel('ai-video  tools')).toBe('AI-Video Tools')
  })

  it('builds absolute URLs on the production host', () => {
    expect(absoluteUrl('/r/x-e86d24f7')).toBe('https://reelset.app/r/x-e86d24f7')
  })
})

describe('scriptParts', () => {
  it('joins hook, beats and outro, and keeps claims', () => {
    const parts = scriptParts({
      hook: 'Hook.',
      beats: [{ text: 'One.' }, { text: '' }, { nope: 1 }, { text: 'Two.' }],
      outro: 'Bye.',
      claims: [{ text: 'Fact', chunkIds: ['c1', 2] }, { text: '' }],
    })
    expect(parts).toEqual({
      hook: 'Hook.',
      transcript: 'Hook. One. Two. Bye.',
      claims: [{ text: 'Fact', chunkIds: ['c1'] }],
    })
  })

  it('tolerates missing or malformed scripts', () => {
    expect(scriptParts(null)).toEqual({ hook: null, transcript: null, claims: [] })
    expect(scriptParts({ beats: 'x', claims: {} }).transcript).toBeNull()
  })
})

describe('json-ld', () => {
  it('describes a reel with a live video as a VideoObject plus breadcrumbs', () => {
    const [video, crumbs] = reelJsonLd(reel)
    expect(video).toMatchObject({
      '@type': 'VideoObject',
      name: reel.title,
      url: 'https://reelset.app/r/claude-solved-two-unsolved-problems-e86d24f7',
      thumbnailUrl: [reel.posterUrl],
      contentUrl: reel.videoUrl,
      duration: 'PT1M5S',
      uploadDate: reel.renderedAt,
      transcript: reel.transcript,
    })
    expect(video?.citation).toEqual([
      'https://example.com/story',
      'https://news.ycombinator.com/item?id=1',
      'https://arxiv.org/x',
    ])
    expect(crumbs).toMatchObject({ '@type': 'BreadcrumbList' })
    expect((crumbs?.itemListElement as { item: string }[]).map((c) => c.item)).toEqual([
      'https://reelset.app',
      'https://reelset.app/t/ai',
      'https://reelset.app/r/claude-solved-two-unsolved-problems-e86d24f7',
    ])
  })

  it('falls back to an Article once the video is gone', () => {
    const [article] = reelJsonLd({ ...reel, videoUrl: null, posterUrl: null })
    expect(article).toMatchObject({ '@type': 'Article', headline: reel.title })
    expect(article).not.toHaveProperty('contentUrl')
  })

  it('escapes script-breaking characters', () => {
    expect(jsonLdHtml({ a: '</script><script>alert(1)</script>' })).not.toContain('</script>')
  })

  it('lists topic reels in order', () => {
    const [page] = topicJsonLd('AI', '/t/ai', [summary(ID)])
    expect(page).toMatchObject({ '@type': 'CollectionPage', url: 'https://reelset.app/t/ai' })
    expect(siteJsonLd().map((d) => d['@type'])).toEqual(['Organization', 'WebSite'])
  })
})

describe('topics', () => {
  it('groups spellings by slug, keeps the most used label and sorts by count', () => {
    const topics = groupTopics([
      { label: 'ai', count: 2 },
      { label: 'AI', count: 5 },
      { label: 'Rust', count: 3 },
      { label: '日本', count: 9 },
    ])
    expect(topics).toEqual([
      { slug: 'ai', label: 'AI', count: 7 },
      { slug: 'rust', label: 'Rust', count: 3 },
    ])
    expect(indexedTopics([...topics, { slug: 'go', label: 'Go', count: 2 }])).toHaveLength(2)
  })
})

describe('sitemap', () => {
  it('lists pages, indexed topics and reels with video entries', () => {
    const map = buildSitemap({
      reels: [summary(ID), summary('aa0000000-0000-0000-0000-000000000000', { videoUrl: null })],
      topics: [
        { slug: 'ai', label: 'AI', count: 4 },
        { slug: 'go', label: 'Go', count: 1 },
      ],
      retentionDays: 30,
      now: new Date('2026-11-12T00:00:00Z'),
    })
    const urls = map.map((m) => m.url)
    expect(urls.slice(0, 4)).toEqual([
      'https://reelset.app/',
      'https://reelset.app/t',
      'https://reelset.app/ask',
      'https://reelset.app/t/ai',
    ])
    expect(urls).not.toContain('https://reelset.app/t/go')
    const withVideo = map.find((m) => m.url.endsWith('e86d24f7'))
    expect(withVideo?.videos?.[0]).toMatchObject({
      content_loc: 'https://m/v.mp4',
      duration: 60,
      expiration_date: '2026-12-11T00:00:00.000Z',
    })
    expect(map.at(-1)?.videos).toBeUndefined()
  })

  it('escapes titles and descriptions so the served XML stays well-formed', () => {
    const map = buildSitemap({
      reels: [
        summary(ID, {
          title: 'Qwen 4 Max & 27B <beta> "wow"',
          tldr: "Tom's M&Ms \u0007test",
        }),
      ],
      topics: [],
      retentionDays: 30,
      now: new Date('2026-11-12T00:00:00Z'),
    })
    const video = map.find((m) => m.url.endsWith('e86d24f7'))?.videos?.[0]
    expect(video?.title).toBe('Qwen 4 Max &amp; 27B &lt;beta&gt; &quot;wow&quot;')
    expect(video?.description).toContain('Tom&apos;s M&amp;Ms test')

    const xml = resolveSitemap(map)
    const bareAmpersand = /&(?!(?:amp|lt|gt|quot|apos);)/
    expect(xml).not.toMatch(bareAmpersand)
    expect(xml).not.toMatch(/[\u0000-\u0008]/)
  })

  it('xmlText leaves plain text alone', () => {
    expect(xmlText('https://reelset.app/r/a-b')).toBe('https://reelset.app/r/a-b')
  })
})

describe('llms.txt', () => {
  it('summarises the site and links topics and reels', () => {
    const text = buildLlmsTxt({
      reels: [summary(ID, { title: 'A [weird] title' })],
      topics: [{ slug: 'ai', label: 'AI', count: 4 }],
    })
    expect(text.startsWith('# Reelset\n\n> ')).toBe(true)
    expect(text).toContain('- [AI](https://reelset.app/t/ai): 4 reels')
    expect(text).toContain('- [A weird title](https://reelset.app/r/a-weird-title-e86d24f7)')
  })

  it('inlines summaries and transcripts in the full version', () => {
    const text = buildLlmsFullTxt([
      { ...summary(ID), transcript: 'Spoken words.', sourceUrl: 'https://example.com' },
    ])
    expect(text).toContain('TL;DR: Short summary.')
    expect(text).toContain('Transcript: Spoken words.')
    expect(text).toContain('Source: https://example.com')
  })
})
