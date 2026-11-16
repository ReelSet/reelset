import { describe, expect, it } from 'vitest'
import { endSources } from './end-sources'

const m = (url: string | null) => ({ url, score: null })

describe('endSources', () => {
  it('canonical first, then other hosts by order, max 3', () => {
    const got = endSources({
      source: 'news',
      canonicalUrl: 'https://www.theverge.com/a',
      mentions: [
        m('https://news.ycombinator.com/item?id=1'),
        m('https://www.reddit.com/r/x/comments/1'),
        m('https://theverge.com/b'),
        m('https://arstechnica.com/c'),
      ],
    })
    expect(got).toEqual(['theverge.com', 'news.ycombinator.com', 'reddit.com'])
  })

  it('github canonical shows owner/repo', () => {
    const got = endSources({
      source: 'github',
      canonicalUrl: 'https://github.com/acme/tool/',
      mentions: [],
    })
    expect(got).toEqual(['github.com/acme/tool'])
  })

  it('dedupes by host and skips bad urls', () => {
    const got = endSources({
      source: 'hn',
      canonicalUrl: 'https://example.com/post',
      mentions: [m(null), m('not a url'), m('https://www.example.com/other')],
    })
    expect(got).toEqual(['example.com'])
  })

  it('truncates long labels to 48 chars', () => {
    const repo = `acme/${'x'.repeat(60)}`
    const [label] = endSources({
      source: 'github',
      canonicalUrl: `https://github.com/${repo}`,
      mentions: [],
    })
    expect(label).toHaveLength(48)
    expect(label!.endsWith('…')).toBe(true)
  })
})
