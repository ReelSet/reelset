const MARK = /\s?\[(\d{1,3})\]/g

type Cited = { refs?: number[] }

// Removes [n] marks that point at no cited source, so stored answers never carry dead marks.
export function dropUnknownMarks(answer: string, citations: readonly Cited[]): string {
  const known = new Set(citations.flatMap((c) => c.refs ?? []))
  return answer.replace(MARK, (all, n: string) => (known.has(Number(n)) ? all : ''))
}

export function stripCitationMarks(text: string): string {
  return text.replace(MARK, '')
}

export type AnswerPart = { type: 'text'; text: string } | { type: 'cite'; sources: number[] }

// Splits answer text into text and citation parts. Adjacent marks merge into one part whose
// `sources` are indexes into `citations`; marks with no matching citation are dropped.
export function splitAnswer(text: string, citations: readonly Cited[]): AnswerPart[] {
  const indexOfRef = new Map<number, number>()
  citations.forEach((c, i) => {
    for (const ref of c.refs ?? []) if (!indexOfRef.has(ref)) indexOfRef.set(ref, i)
  })
  const parts: AnswerPart[] = []
  const push = (part: AnswerPart) => {
    const prev = parts[parts.length - 1]
    if (part.type === 'text') {
      if (!part.text) return
      if (prev?.type === 'text') prev.text += part.text
      else parts.push(part)
    } else if (prev?.type === 'cite') {
      for (const s of part.sources) if (!prev.sources.includes(s)) prev.sources.push(s)
    } else parts.push(part)
  }
  let last = 0
  for (const m of text.matchAll(MARK)) {
    const start = m.index ?? 0
    push({ type: 'text', text: text.slice(last, start) })
    last = start + m[0].length
    const source = indexOfRef.get(Number(m[1]))
    if (source !== undefined) push({ type: 'cite', sources: [source] })
  }
  push({ type: 'text', text: text.slice(last) })
  return parts
}
