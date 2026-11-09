const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '\u2014',
  ndash: '\u2013',
  hellip: '\u2026',
  rsquo: '\u2019',
  lsquo: '\u2018',
  rdquo: '\u201d',
  ldquo: '\u201c',
  copy: '\u00a9',
  '#x27': "'",
  '#39': "'",
  '#x2f': '/',
  '#47': '/',
}

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, name: string) => {
    const lower = name.toLowerCase()
    const named = ENTITIES[lower]
    if (named !== undefined) return named
    if (lower.startsWith('#x')) return safeCodePoint(parseInt(lower.slice(2), 16)) ?? match
    if (lower.startsWith('#')) return safeCodePoint(parseInt(lower.slice(1), 10)) ?? match
    return match
  })
}

function safeCodePoint(code: number): string | null {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return null
  return String.fromCodePoint(code)
}

export function stripHtml(html: string): string {
  const withBreaks = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\s*\/?\s*(p|br|div|li|h[1-6]|tr|pre|blockquote)\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
  return decodeEntities(withBreaks)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max)
}
