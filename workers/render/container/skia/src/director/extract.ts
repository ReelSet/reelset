const FENCE = /```(?:js|javascript)?[ \t]*\r?\n([\s\S]*?)```/g

/** Longest complete fenced code block in a reply; null when none is closed (e.g. a truncated reply). */
export function extractCode(text: string): string | null {
  let best: string | null = null
  for (const m of text.matchAll(FENCE)) {
    const body = m[1] ?? ''
    if (best === null || body.length > best.length) best = body
  }
  return best && best.trim() ? best : null
}
