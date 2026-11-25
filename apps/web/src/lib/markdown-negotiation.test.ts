import { describe, expect, it } from 'vitest'
import { markdownResponse, markdownRewritePath, wantsMarkdown } from './markdown-negotiation'

const CHROME =
  'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8'
const SAFARI = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
const FIREFOX = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'

it.each([
  CHROME,
  SAFARI,
  FIREFOX,
  '*/*',
  '',
  null,
  'text/markdown;q=0',
  'text/html, text/markdown;q=0.5',
])('serves HTML for %s', (a) => expect(wantsMarkdown(a)).toBe(false))
it.each([
  'text/markdown',
  'text/markdown, text/html;q=0.9',
  'text/html;q=0.5, TEXT/MARKDOWN',
  'text/markdown;charset=utf-8',
])('serves markdown for %s', (a) => expect(wantsMarkdown(a)).toBe(true))

describe('markdownRewritePath', () => {
  it('maps .md URLs regardless of Accept', () => {
    expect(markdownRewritePath('/index.md', null)).toBe('/api/md/home')
    expect(markdownRewritePath('/r/some-title-bf57c544.md', null)).toBe(
      '/api/md/r/some-title-bf57c544',
    )
  })
  it('maps / and reel pages only when markdown is asked for', () => {
    expect(markdownRewritePath('/', 'text/markdown')).toBe('/api/md/home')
    expect(markdownRewritePath('/r/some-title-bf57c544', 'text/markdown')).toBe(
      '/api/md/r/some-title-bf57c544',
    )
    expect(markdownRewritePath('/r/some-title-bf57c544/', 'text/markdown')).toBe(
      '/api/md/r/some-title-bf57c544',
    )
    expect(markdownRewritePath('/', CHROME)).toBeNull()
    expect(markdownRewritePath('/r/some-title-bf57c544', null)).toBeNull()
  })
  it('leaves other paths alone', () => {
    expect(markdownRewritePath('/r/x-bf57c544/opengraph-image', 'text/markdown')).toBeNull()
    expect(markdownRewritePath('/t/ai', 'text/markdown')).toBeNull()
    expect(markdownRewritePath('/notes.md', null)).toBeNull()
  })
})

describe('markdownResponse', () => {
  it('sets markdown headers and a token estimate', async () => {
    const res = markdownResponse('# Hi there')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/markdown; charset=utf-8')
    expect(res.headers.get('vary')).toBe('Accept')
    expect(res.headers.get('x-markdown-tokens')).toBe('3')
    expect(res.headers.get('content-signal')).toBe('search=yes, ai-input=yes, ai-train=yes')
    expect(res.headers.get('x-robots-tag')).toBeNull()
  })
  it('marks noindex and passes status', () => {
    const res = markdownResponse('# Not found', { status: 404, noindex: true })
    expect(res.status).toBe(404)
    expect(res.headers.get('x-robots-tag')).toBe('noindex')
  })
})
