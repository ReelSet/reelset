import { bare, isFunctionWord } from './text-rules'
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

/** A word worth the accent box: not a function word ("The", "is", "Since") and not bare punctuation. */
export const isHighlightable = (text: string): boolean => {
  const b = bare(text)
  return b.length > 0 && /[\p{L}\p{N}]/u.test(b) && !isFunctionWord(b)
}

/**
 * Index of the word to highlight on a page at time `t`: the spoken word when it carries meaning,
 * otherwise the content word nearest to it (the next one on a tie). -1 when the page has none.
 */
export function highlightIndex(page: readonly Word[], t: number): number {
  const spoken = page.findIndex((w) => t >= w.start && t < w.end + 0.04)
  const at = spoken >= 0 ? spoken : page.findIndex((w) => w.start > t) - 1
  const from = at < 0 ? (t < (page[0]?.start ?? 0) ? 0 : page.length - 1) : at
  let best = -1
  let gap = Infinity
  page.forEach((w, i) => {
    if (!isHighlightable(w.text)) return
    const d = Math.abs(i - from) - (i > from ? 0.1 : 0)
    if (d < gap) {
      gap = d
      best = i
    }
  })
  return best
}
