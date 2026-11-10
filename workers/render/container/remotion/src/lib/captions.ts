import { wordStrength } from './emphasis'
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

/** A word's aligned end can run into the pause after it; a page never lingers on that silence. */
export const LAST_WORD_MAX_S = 0.8

export function pageAt(pages: readonly Word[][], t: number, linger = 0.35): Word[] | null {
  for (const [i, page] of pages.entries()) {
    const first = page[0]
    const last = page[page.length - 1]
    if (!first || !last) continue
    const next = pages[i + 1]?.[0]?.start ?? Infinity
    const spoken = Math.min(last.end, last.start + LAST_WORD_MAX_S)
    if (t >= first.start && t < Math.min(next, spoken + linger)) return page
  }
  return null
}

/**
 * A caption word as shown: trailing commas, colons, semicolons and full stops are dropped
 * ("distillation," -> "distillation", "2.15." -> "2.15"); "?" and "!" stay, and so do
 * initialisms ("U.S.") and anything inside the word ("outlook.com").
 */
export function captionWord(text: string): string {
  if (/^(?:[A-Za-z]\.){2,}$/.test(text)) return text
  const out = text.replace(/[.,;:]+$/, '')
  return out || text
}

/** A word worth the accent box: a content word, name or real number (see `wordStrength`). */
export const isHighlightable = (text: string, prev = ''): boolean => wordStrength(text, prev) >= 2

/**
 * Index of the word to highlight on a page at time `t`: the strongest word on the page (numbers and
 * names over plain content words; verbs, "one" and version numbers never), the one nearest the
 * spoken word when several tie. `prev` is the word before the page. -1 when none qualifies.
 */
export function highlightIndex(page: readonly Word[], t: number, prev = ''): number {
  const spoken = page.findIndex((w) => t >= w.start && t < w.end + 0.04)
  const at = spoken >= 0 ? spoken : page.findIndex((w) => w.start > t) - 1
  const from = at < 0 ? (t < (page[0]?.start ?? 0) ? 0 : page.length - 1) : at
  const strength = page.map((w, i) => wordStrength(w.text, i > 0 ? page[i - 1]!.text : prev))
  const top = Math.max(0, ...strength)
  if (top < 2) return -1
  let best = -1
  let gap = Infinity
  page.forEach((_, i) => {
    if (strength[i] !== top) return
    const d = Math.abs(i - from) - (i > from ? 0.1 : 0)
    if (d < gap) {
      gap = d
      best = i
    }
  })
  return best
}
