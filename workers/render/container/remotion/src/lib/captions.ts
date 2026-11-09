import type { Word } from './types'

const BREAK = /[.?!,;:]$/

export function toPages(words: readonly Word[], maxWords = 4, maxChars = 26): Word[][] {
  const pages: Word[][] = []
  let page: Word[] = []
  for (const word of words) {
    const chars = [...page, word].map((w) => w.text).join(' ').length
    if (page.length > 0 && (page.length >= maxWords || chars > maxChars)) {
      pages.push(page)
      page = []
    }
    page.push(word)
    if (BREAK.test(word.text)) {
      pages.push(page)
      page = []
    }
  }
  if (page.length > 0) pages.push(page)
  return pages
}

export function pageAt(pages: readonly Word[][], t: number, linger = 0.35): Word[] | null {
  for (const [i, page] of pages.entries()) {
    const first = page[0]
    const last = page[page.length - 1]
    if (!first || !last) continue
    const next = pages[i + 1]?.[0]?.start ?? Infinity
    if (t >= first.start && t < Math.min(next, last.end + linger)) return page
  }
  return null
}
