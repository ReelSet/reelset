import { describe, expect, it } from 'vitest'
import { reelPath } from '@/lib/reel-url'
import { reelMarkdown } from './reel-markdown'
import type { ReelPageData } from './types'

const full: ReelPageData = {
  id: 'bf57c544-1111-2222-3333-444455556666',
  visibility: 'public',
  title: 'Bun 2 ships [beta]',
  tldr: 'Bun 2 is out with a faster installer.',
  hook: 'Bun 2 is here',
  transcript: 'Bun two just shipped. It installs packages faster.',
  topics: ['a', 'b'],
  kind: 'repo',
  canonicalUrl: 'https://github.com/oven-sh/bun',
  publishedAt: '2026-11-20T10:00:00.000Z',
  renderedAt: '2026-11-20T12:00:00.000Z',
  videoUrl: 'https://media.reelset.app/v/bun.mp4',
  posterUrl: 'https://media.reelset.app/p/bun.jpg',
  durationMs: 60000,
  facts: [
    {
      text: 'Installs are 3x faster',
      sources: [
        { url: 'https://example.com/one', title: 'Release [notes]' },
        { url: 'https://example.com/two', title: 'Benchmarks' },
      ],
    },
  ],
  mentions: [
    {
      source: 'hn',
      url: 'https://news.ycombinator.com/item?id=1',
      title: 'Bun 2 discussion',
      author: 'x',
      score: 120,
      comments: 45,
    },
    {
      source: 'reddit',
      url: 'https://www.reddit.com/r/javascript/comments/abc',
      title: null,
      author: null,
      score: null,
      comments: null,
    },
  ],
}

const bare: ReelPageData = {
  ...full,
  tldr: null,
  transcript: null,
  videoUrl: null,
  posterUrl: null,
  facts: [],
  mentions: [],
}

describe('reelMarkdown', () => {
  const md = reelMarkdown(full)

  it('opens with the title and TL;DR', () => {
    expect(md.startsWith(`# Bun 2 ships [beta]\n\n> ${full.tldr}`)).toBe(true)
  })

  it('lists the reel details', () => {
    expect(md).toContain(`- Reel: https://reelset.app${reelPath(full)}`)
    expect(md).toContain('- Original: https://github.com/oven-sh/bun')
    expect(md).toContain('- Published: 2026-11-20')
    expect(md).toContain('- Topics: a, b')
    expect(md).toContain('- Video: https://media.reelset.app/v/bun.mp4')
  })

  it('renders key facts with their sources', () => {
    expect(md).toContain('## Key facts')
    expect(md).toContain(
      '- Installs are 3x faster ([Release notes](https://example.com/one), [Benchmarks](https://example.com/two))',
    )
  })

  it('renders the transcript and discussion', () => {
    expect(md).toContain(`## Transcript\n\n${full.transcript}`)
    expect(md).toContain('## Discussion')
    expect(md).toContain(
      '- [Bun 2 discussion](https://news.ycombinator.com/item?id=1) on hn, 120 points, 45 comments',
    )
    expect(md).toContain(
      '- [reddit.com](https://www.reddit.com/r/javascript/comments/abc) on reddit\n',
    )
  })

  it('ends with a newline and the llms.txt pointer', () => {
    expect(md.endsWith('\n')).toBe(true)
    expect(md).toContain('More developer stories: https://reelset.app/llms.txt')
  })

  it('omits missing pieces instead of printing null', () => {
    const text = reelMarkdown(bare)
    expect(text).not.toMatch(/null|undefined/)
    for (const part of ['## Key facts', '## Transcript', '## Discussion', '- Video:', '> '])
      expect(text).not.toContain(part)
  })

  it('keeps a multi-line title on one line', () => {
    const text = reelMarkdown({ ...full, title: 'Two\nlines  here' })
    expect(text.split('\n')[0]).toBe('# Two lines here')
  })
})
