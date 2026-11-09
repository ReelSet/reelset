import { describe, expect, it } from 'vitest'
import { canonicalizeUrl, kindForKey, resolveItemTarget } from '../src/canonical'

const cases: [string, string, string][] = [
  ['https://github.com/Cloudflare/Workerd', 'github:cloudflare/workerd', 'repo'],
  ['https://www.github.com/cloudflare/workerd/', 'github:cloudflare/workerd', 'repo'],
  ['http://github.com/cloudflare/workerd.git', 'github:cloudflare/workerd', 'repo'],
  ['https://github.com/cloudflare/workerd/tree/main/src', 'github:cloudflare/workerd', 'repo'],
  [
    'https://github.com/cloudflare/workerd/blob/main/README.md#usage',
    'github:cloudflare/workerd',
    'repo',
  ],
  ['https://github.com/cloudflare/workerd?utm_source=hn', 'github:cloudflare/workerd', 'repo'],
  ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s', 'youtube:dQw4w9WgXcQ', 'video'],
  ['https://youtu.be/dQw4w9WgXcQ?si=abc', 'youtube:dQw4w9WgXcQ', 'video'],
  ['https://www.youtube.com/shorts/dQw4w9WgXcQ', 'youtube:dQw4w9WgXcQ', 'video'],
  ['https://www.youtube.com/embed/dQw4w9WgXcQ', 'youtube:dQw4w9WgXcQ', 'video'],
  ['https://m.youtube.com/watch?v=dQw4w9WgXcQ', 'youtube:dQw4w9WgXcQ', 'video'],
  [
    'http://WWW.Example.com/Post/?utm_source=x&utm_medium=y&id=3#top',
    'https://example.com/Post?id=3',
    'article',
  ],
  ['https://example.com/a/?fbclid=1&gclid=2&ref=hn', 'https://example.com/a', 'article'],
  ['https://example.com/', 'https://example.com', 'article'],
  ['https://example.com/a?b=2&a=1', 'https://example.com/a?a=1&b=2', 'article'],
  ['https://example.com:443/x', 'https://example.com/x', 'article'],
]

describe('canonicalizeUrl', () => {
  it.each(cases)('%s -> %s', (input, key, kind) => {
    const target = canonicalizeUrl(input)
    expect(target?.canonicalKey).toBe(key)
    expect(target?.kind).toBe(kind)
  })

  it('treats non-repo github pages as plain urls', () => {
    expect(canonicalizeUrl('https://github.com/sponsors/foo')?.canonicalKey).toBe(
      'https://github.com/sponsors/foo',
    )
    expect(canonicalizeUrl('https://github.com/cloudflare')?.kind).toBe('article')
  })

  it('does not treat a bad youtube id as a video', () => {
    expect(canonicalizeUrl('https://www.youtube.com/watch?v=short')?.kind).toBe('article')
  })

  it('rejects non-http and invalid urls', () => {
    expect(canonicalizeUrl('ftp://example.com/x')).toBeNull()
    expect(canonicalizeUrl('not a url')).toBeNull()
    expect(canonicalizeUrl('javascript:alert(1)')).toBeNull()
  })

  it('rejects keys longer than the column allows', () => {
    expect(canonicalizeUrl(`https://example.com/${'a'.repeat(600)}`)).toBeNull()
  })
})

describe('resolveItemTarget', () => {
  it('maps an HN link post to the linked item', () => {
    const t = resolveItemTarget({
      source: 'hn',
      externalId: '1',
      url: 'https://news.ycombinator.com/item?id=1',
      linkedUrl: 'https://github.com/a/b',
    })
    expect(t?.canonicalKey).toBe('github:a/b')
  })

  it('keeps self posts as their own discussion item', () => {
    const hn = resolveItemTarget({
      source: 'hn',
      externalId: '42',
      url: 'https://news.ycombinator.com/item?id=42',
      linkedUrl: null,
    })
    expect(hn).toEqual({
      canonicalKey: 'hn:42',
      canonicalUrl: 'https://news.ycombinator.com/item?id=42',
      kind: 'discussion',
    })
    const reddit = resolveItemTarget({
      source: 'reddit',
      externalId: 'abc',
      url: 'https://www.reddit.com/r/x/comments/abc/',
      linkedUrl: 'https://i.redd.it/foo.png',
    })
    expect(reddit?.canonicalKey).toBe('reddit:abc')
  })

  it('canonicalizes news, github and youtube mentions by their own url', () => {
    expect(
      resolveItemTarget({
        source: 'news',
        externalId: 'g',
        url: 'https://blog.example.com/p?utm_source=rss',
        linkedUrl: 'https://blog.example.com/p?utm_source=rss',
      })?.canonicalKey,
    ).toBe('https://blog.example.com/p')
  })
})

describe('kindForKey', () => {
  it('maps keys to item kinds', () => {
    expect(kindForKey('github:a/b')).toBe('repo')
    expect(kindForKey('youtube:abcdefghijk')).toBe('video')
    expect(kindForKey('hn:1')).toBe('discussion')
    expect(kindForKey('reddit:x')).toBe('discussion')
    expect(kindForKey('https://example.com/a')).toBe('article')
  })
})
