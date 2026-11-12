// Largest font size whose estimated wrapped height fits the box. Estimate only; the box has slack.
export function fitText(
  text: string,
  box: { width: number; height: number },
  opts: { min: number; max: number; charWidth?: number; lineHeight?: number },
): number {
  const charWidth = opts.charWidth ?? 0.56
  const lineHeight = opts.lineHeight ?? 1.12
  for (let size = opts.max; size > opts.min; size -= 2) {
    if (estimateLines(text, box.width, size * charWidth) * size * lineHeight <= box.height) {
      return size
    }
  }
  return opts.min
}

export function estimateLines(text: string, width: number, charPx: number): number {
  const perLine = Math.max(1, Math.floor(width / charPx))
  let lines = 1
  let used = 0
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const need = word.length + (used > 0 ? 1 : 0)
    if (used + need > perLine && used > 0) {
      lines += 1
      used = word.length
    } else {
      used += need
    }
    while (used > perLine) {
      lines += 1
      used -= perLine
    }
  }
  return lines
}

/** Up to `n` characters of `text` around `phrase`, cut on word boundaries. */
export function windowAround(text: string, phrase: string, n: number): string {
  if (text.length <= n) return text
  const at = phrase ? text.toLowerCase().indexOf(phrase.toLowerCase()) : -1
  if (at < 0) return `${text.slice(0, n - 3).replace(/\s+\S*$/, '')}...`
  const start = Math.max(0, Math.min(at - Math.round(n * 0.35), text.length - n))
  const head = start > 0 ? `...${text.slice(start).replace(/^\S*\s+/, '')}` : text
  return head.length > n ? `${head.slice(0, n - 3).replace(/\s+\S*$/, '')}...` : head
}

/**
 * The longest window of `text` around `phrase` (whole words, at most `max` chars) that fits `box`
 * at a size of at least `opts.min`, with that size. Nothing runs past the box into the captions.
 */
export function fitWindow(
  text: string,
  phrase: string,
  box: { width: number; height: number },
  opts: { min: number; max: number; charWidth?: number; lineHeight?: number },
  max = 320,
): { body: string; size: number } {
  const charPx = opts.min * (opts.charWidth ?? 0.56)
  const lh = opts.min * (opts.lineHeight ?? 1.12)
  for (let n = max; n >= 60; n -= 20) {
    const body = windowAround(text, phrase, n)
    if (estimateLines(body, box.width, charPx) * lh <= box.height)
      return { body, size: fitText(body, box, opts) }
  }
  const body = windowAround(text, phrase, 60)
  return { body, size: opts.min }
}

/** Whole sentences of `text` up to `n` characters (the first one clipped on a word if it is longer). */
export function sentencesUpTo(text: string, n: number): string {
  const parts = text
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?])\s+/)
  let out = ''
  for (const p of parts) {
    if ((out ? out.length + 1 : 0) + p.length > n) break
    out = out ? `${out} ${p}` : p
  }
  if (out) return out
  return `${text.slice(0, n - 1).replace(/\s+\S*$/, '')}…`
}
