const MARKER = 'CITATIONS:'
const MARKER_LINE = /(?:^|\n)CITATIONS:/
const MAX_ANSWER_CHARS = 6000
const MAX_CITATIONS = 50

export type ModelAnswer = { answer: string; citations: string[] }

export type GeneratedAnswer = {
  text: string
  inputTokens: number
  outputTokens: number
  parsed: ModelAnswer | null
}

export function parseCitationIds(raw: string): string[] {
  const ids = raw
    .split(/[\s,]+/)
    .map((token) => token.replace(/^[[("']+|[\])"'.]+$/g, ''))
    .filter((token) => token && token.toLowerCase() !== 'none' && /^[\w-]+$/.test(token))
  return [...new Set(ids)].slice(0, MAX_CITATIONS)
}

// The model writes the answer as plain text followed by a final "CITATIONS:" line, so the text
// can be streamed to the client while the citation list is only parsed once the stream ends.
export function createAnswerSplitter(onText: (text: string) => void) {
  let full = ''
  let emitted = 0
  let markerAt = -1

  const emitUpTo = (limit: number) => {
    if (limit > emitted) {
      onText(full.slice(emitted, limit))
      emitted = limit
    }
  }

  return {
    push(delta: string) {
      full += delta
      if (markerAt === -1) markerAt = MARKER_LINE.exec(full)?.index ?? -1
      // Hold back a possible partial marker so "CITATIONS" never reaches the client.
      emitUpTo(markerAt === -1 ? full.length - MARKER.length : markerAt)
    },
    finish(): { text: string; parsed: ModelAnswer | null } {
      if (markerAt === -1) {
        emitUpTo(full.length)
        return { text: full, parsed: null }
      }
      emitUpTo(markerAt)
      const answer = full.slice(0, markerAt).trim().slice(0, MAX_ANSWER_CHARS)
      const trailer = full.slice(markerAt).replace(/^\n?CITATIONS:/, '')
      return { text: full, parsed: { answer, citations: parseCitationIds(trailer) } }
    },
  }
}
