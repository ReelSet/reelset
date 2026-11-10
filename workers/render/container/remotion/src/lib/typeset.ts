const SUP: Record<string, string> = {
  '0': '⁰',
  '1': '¹',
  '2': '²',
  '3': '³',
  '4': '⁴',
  '5': '⁵',
  '6': '⁶',
  '7': '⁷',
  '8': '⁸',
  '9': '⁹',
  '+': '⁺',
  '-': '⁻',
  n: 'ⁿ',
}
const SUB: Record<string, string> = {
  '0': '₀',
  '1': '₁',
  '2': '₂',
  '3': '₃',
  '4': '₄',
  '5': '₅',
  '6': '₆',
  '7': '₇',
  '8': '₈',
  '9': '₉',
}

const map = (s: string, table: Record<string, string>): string | null => {
  const out = [...s].map((c) => table[c])
  return out.every(Boolean) ? out.join('') : null
}

/**
 * Display text for math-ish source strings: `P^2` -> `P²`, `x_1` -> `x₁`, `^{-1}` braces dropped.
 * Anything that has no unicode form keeps its caret/underscore so no character is ever lost.
 */
export function typeset(text: string): string {
  return text
    .replace(/\^\{([^}]{1,6})\}|\^([+-]?\d{1,3}|n)/g, (m, braced?: string, bare?: string) => {
      const body = braced ?? bare ?? ''
      return map(body, SUP) ?? m
    })
    .replace(/(?<=[A-Za-z\])])_\{?(\d{1,3})\}?/g, (m, digits: string) => map(digits, SUB) ?? m)
}

/** Item title as shown on screen; `owner/repo` slugs stay verbatim (`llama_3` is a name, not math). */
/** A source title as shown: typeset, with an accidental doubled word ("has has") removed. */
export const displayTitle = (title: string): string => {
  const t = title.trim().replace(/\b(\p{L}+)\s+\1\b/giu, '$1')
  return /^[\w.-]+\/[\w.-]+$/.test(t) ? t : typeset(t)
}

/** Longest unbreakable run of characters in a text, used to keep every word inside the frame. */
export const longestWord = (text: string): number =>
  Math.max(1, ...text.split(/\s+/).map((w) => [...w].length))

/**
 * Font size that fits the widest word on one line and the whole text in the box. `upper` text is
 * wider per character, so it gets a larger width factor.
 */
export function fitWords(
  text: string,
  box: { width: number; height: number },
  opts: { min: number; max: number; upper?: boolean; lineHeight?: number },
): number {
  const charW = opts.upper ? 0.82 : 0.68
  const widest = box.width / (longestWord(text) * charW)
  const lines = (size: number) => {
    const perLine = Math.max(1, Math.floor(box.width / (size * charW)))
    let n = 1
    let used = 0
    for (const w of text.split(/\s+/).filter(Boolean)) {
      const need = [...w].length + (used > 0 ? 1 : 0)
      if (used + need > perLine && used > 0) {
        n += 1
        used = [...w].length
      } else used += need
    }
    return n
  }
  const lh = opts.lineHeight ?? 1.05
  for (let size = Math.min(opts.max, Math.floor(widest)); size > opts.min; size -= 2) {
    if (lines(size) * size * lh <= box.height) return size
  }
  return Math.min(opts.min, Math.max(24, Math.floor(widest)))
}

const hash = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7)

/**
 * KeyPoint layout (0 left, 1 uppercase, 2 right-aligned), a pure function of its text. Uppercase
 * only when its longest word stays short: a long uppercase word forces small type in a big frame.
 */
export const styleOf = (text: string): number => {
  const t = text.replace(/\s+/g, ' ').trim()
  const style = hash(t) % 3
  return style === 1 && longestWord(t) > 9 ? 0 : style
}
