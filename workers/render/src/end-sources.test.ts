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
    expect(got).toEqual([
      'theverge.com/a',
      'news.ycombinator.com/item?id=1',
      'reddit.com/r/x/comments/1',
    ])
  })

  it('shows the full link without scheme, www or a trailing slash', () => {
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
    expect(got).toEqual(['example.com/post'])
  })

  it('drops tracking params and keeps the rest of the query', () => {
    const [label] = endSources({
      source: 'news',
      canonicalUrl: 'https://qwen.ai/blog?id=qwen4-max&utm_source=x&fbclid=1',
      mentions: [],
    })
    expect(label).toBe('qwen.ai/blog?id=qwen4-max')
  })

  it('truncates very long links', () => {
    const [label] = endSources({
      source: 'news',
      canonicalUrl: `https://example.com/${'x'.repeat(200)}`,
      mentions: [],
    })
    expect(label).toHaveLength(120)
    expect(label!.endsWith('…')).toBe(true)
  })
})
