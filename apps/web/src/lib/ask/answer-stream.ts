import type { ClaudeModel } from '@reelset/core'

const MARKER = 'CITATIONS:'
const MARKER_LINE = /(?:^|\n)(?:CITATIONS|FOLLOWUPS):/
const FOLLOWUPS_LINE = /(?:^|\n)FOLLOWUPS:([^\n]*)/
const CITATIONS_LINE = /(?:^|\n)CITATIONS:([^\n]*)/
const MAX_FOLLOWUPS = 3
const FOLLOWUP_MIN_CHARS = 8
const FOLLOWUP_MAX_CHARS = 120
const MAX_ANSWER_CHARS = 6000
const MAX_CITATIONS = 50

export type ModelAnswer = { answer: string; citations: string[]; followups: string[] }

export type GeneratedAnswer = {
  text: string
  model: ClaudeModel
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

export function parseFollowups(raw: string): string[] {
  const out: string[] = []
  for (const part of raw.split('|')) {
    const q = part
      .replace(/\[\d+\]/g, '')
      .replace(/^[\s\-*\d.)]+/, '')
      .trim()
    if (q.length < FOLLOWUP_MIN_CHARS || q.length > FOLLOWUP_MAX_CHARS || !q.endsWith('?')) continue
    if (!out.includes(q)) out.push(q)
    if (out.length === MAX_FOLLOWUPS) break
  }
  return out
}

// The model writes the answer as plain text, then a "FOLLOWUPS:" line and a final "CITATIONS:"
// line, so the text can be streamed to the client while the trailer is only parsed at the end.
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
      const trailer = full.slice(markerAt)
      return {
        text: full,
        parsed: {
          answer,
          citations: parseCitationIds(CITATIONS_LINE.exec(trailer)?.[1] ?? ''),
          followups: parseFollowups(FOLLOWUPS_LINE.exec(trailer)?.[1] ?? ''),
        },
      }
    },
  }
}
