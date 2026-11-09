import { decodeEntities, stripHtml } from './html'

export type FeedEntry = {
  id: string
  title: string
  link: string
  publishedAt: Date | null
  text: string
}

function blocks(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'gi')
  return [...xml.matchAll(re)].map((m) => m[1] ?? '')
}

function rawTag(block: string, tag: string): string | null {
  const escaped = tag.replace(':', '\\:')
  const match = new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)</${escaped}>`, 'i').exec(block)
  return match ? (match[1] ?? '') : null
}

function unwrap(value: string): string {
  const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(value)
  return cdata ? (cdata[1] ?? '') : decodeEntities(value)
}

function plainTag(block: string, tag: string): string | null {
  const raw = rawTag(block, tag)
  if (raw === null) return null
  const text = unwrap(raw).trim()
  return text || null
}

function htmlTag(block: string, tag: string): string | null {
  const raw = rawTag(block, tag)
  if (raw === null) return null
  const text = stripHtml(unwrap(raw))
  return text || null
}

function atomLink(block: string): string | null {
  const links = [...block.matchAll(/<link\b([^>]*?)\/?>/gi)].map((m) => m[1] ?? '')
  const attr = (attrs: string, name: string) =>
    new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(attrs)?.[1] ?? null
  const preferred =
    links.find((a) => (attr(a, 'rel') ?? 'alternate') === 'alternate' && attr(a, 'href')) ??
    links.find((a) => attr(a, 'href'))
  const href = preferred ? attr(preferred, 'href') : null
  return href ? decodeEntities(href) : null
}

function parseDate(value: string | null): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export function parseFeed(xml: string): FeedEntry[] {
  const isAtom = /<feed\b/i.test(xml) && /<entry\b/i.test(xml)
  const entries = isAtom ? blocks(xml, 'entry') : blocks(xml, 'item')
  const out: FeedEntry[] = []

  for (const entry of entries) {
    const title = htmlTag(entry, 'title')
    const link = isAtom ? atomLink(entry) : (plainTag(entry, 'link') ?? atomLink(entry))
    if (!title || !link || !/^https?:\/\//i.test(link)) continue

    const id = plainTag(entry, isAtom ? 'id' : 'guid') ?? link
    const publishedAt = parseDate(
      plainTag(entry, 'pubDate') ??
        plainTag(entry, 'published') ??
        plainTag(entry, 'updated') ??
        plainTag(entry, 'dc:date'),
    )
    const text =
      htmlTag(entry, 'content:encoded') ??
      htmlTag(entry, 'content') ??
      htmlTag(entry, 'description') ??
      htmlTag(entry, 'summary') ??
      ''
    out.push({ id, title, link, publishedAt, text })
  }
  return out
}
