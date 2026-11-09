import { describe, expect, it } from 'vitest'
import { decodeEntities, stripHtml } from '../src/html'
import { parseFeed } from '../src/rss'
import { entryToMention } from '../src/sources/news'
import { ATOM_FEED, RSS_FEED } from './fixtures/feeds'

describe('parseFeed (RSS 2.0)', () => {
  const entries = parseFeed(RSS_FEED)

  it('drops items without a link and keeps the rest', () => {
    expect(entries.map((e) => e.title)).toEqual([
      'Announcing Workers & Queues v2',
      'Old post',
      'Bad date',
    ])
  })

  it('prefers content:encoded, strips tags and scripts, decodes entities', () => {
    const first = entries[0]!
    expect(first.text).toBe('Queues v2 is here.\n\nIt ships batching & retries.')
    expect(first.id).toBe('post-123')
    expect(first.link).toBe('https://blog.example.com/queues-v2?utm_source=rss')
    expect(first.publishedAt?.toISOString()).toBe('2026-11-08T10:00:00.000Z')
  })

  it('decodes escaped html in description', () => {
    expect(entries[1]!.text).toBe('Escaped & html')
    expect(entries[1]!.id).toBe('https://blog.example.com/old')
  })

  it('returns null for unparseable dates', () => {
    expect(entries[2]!.publishedAt).toBeNull()
  })
})

describe('parseFeed (Atom)', () => {
  const entries = parseFeed(ATOM_FEED)
  it('uses the alternate link, published date and content', () => {
    expect(entries).toHaveLength(2)
    const first = entries[0]!
    expect(first.link).toBe('https://atom.example.com/rust-2?a=1&b=2')
    expect(first.id).toBe('tag:atom.example.com,2026:rust-2')
    expect(first.publishedAt?.toISOString()).toBe('2026-11-08T09:30:00.000Z')
    expect(first.text).toBe('Full content here')
    expect(first.title).toBe('Rust 2.0 — released')
  })
  it('falls back to updated and a bare link', () => {
    expect(entries[1]!.link).toBe('https://atom.example.com/updated-only')
    expect(entries[1]!.publishedAt?.toISOString()).toBe('2026-11-07T00:00:00.000Z')
    expect(entries[1]!.text).toBe('')
  })
})

describe('parseFeed robustness', () => {
  it('returns [] for empty or non-feed input', () => {
    expect(parseFeed('')).toEqual([])
    expect(parseFeed('<html><body>nope</body></html>')).toEqual([])
    expect(parseFeed('<rss><channel></channel></rss>')).toEqual([])
  })
  it('does not throw on truncated xml', () => {
    expect(() => parseFeed('<rss><channel><item><title>x</title><link>https://a.b')).not.toThrow()
  })
})

describe('entryToMention', () => {
  const entries = parseFeed(RSS_FEED)
  const range = { after: new Date('2026-11-08T00:00:00Z'), before: null }

  it('keeps entries newer than the range start only', () => {
    expect(entryToMention(entries[0]!, range)?.externalId).toBe('post-123')
    expect(entryToMention(entries[1]!, range)).toBeNull()
  })
  it('drops entries without a date', () => {
    expect(entryToMention(entries[2]!, range)).toBeNull()
  })
  it('respects the upper bound for backfill', () => {
    const bounded = { after: range.after, before: new Date('2026-11-08T09:00:00Z') }
    expect(entryToMention(entries[0]!, bounded)).toBeNull()
  })
})

describe('html helpers', () => {
  it('decodes numeric and named entities', () => {
    expect(decodeEntities('&#39;a&#x27; &lt;b&gt; &nbsp;&unknown;')).toBe("'a' <b>  &unknown;")
  })
  it('ignores out-of-range code points', () => {
    expect(decodeEntities('&#99999999;')).toBe('&#99999999;')
  })
  it('strips markup and collapses blank lines', () => {
    expect(stripHtml('<div>a</div><div>b</div><br><br><br><p>c</p>')).toBe('a\n\nb\n\nc')
  })
})
