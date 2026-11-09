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
