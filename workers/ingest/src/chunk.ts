import { CHUNK_TARGET_CHARS, MAX_CHUNKS_PER_MENTION, MAX_TRANSCRIPT_CHUNKS } from './config'

export function chunkText(text: string, target = CHUNK_TARGET_CHARS): string[] {
  const clean = text.replace(/\r\n/g, '\n').trim()
  if (!clean) return []

  const pieces: string[] = []
  for (const paragraph of clean.split(/\n{2,}/)) {
    const p = paragraph.trim()
    if (!p) continue
    if (p.length <= target) {
      pieces.push(p)
      continue
    }
    pieces.push(...splitLong(p, target))
  }

  const chunks: string[] = []
  let current = ''
  for (const piece of pieces) {
    if (!current) {
      current = piece
    } else if (current.length + piece.length + 2 <= target) {
      current = `${current}\n\n${piece}`
    } else {
      chunks.push(current)
      current = piece
    }
  }
  if (current) chunks.push(current)
  return chunks
}

function splitLong(text: string, target: number): string[] {
  const out: string[] = []
  let rest = text
  while (rest.length > target) {
    const window = rest.slice(0, target)
    const sentenceEnd = Math.max(
      window.lastIndexOf('. '),
      window.lastIndexOf('? '),
      window.lastIndexOf('! '),
    )
    const space = window.lastIndexOf(' ')
    const cut = sentenceEnd > target * 0.5 ? sentenceEnd + 1 : space > target * 0.5 ? space : target
    out.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  if (rest) out.push(rest)
  return out
}

export type MentionTextInput = {
  title: string | null
  body: string | null
  extraTexts: readonly string[]
}

export function mentionChunks(
  mention: MentionTextInput,
  maxChunks = MAX_CHUNKS_PER_MENTION,
): string[] {
  const head = [mention.title?.trim(), mention.body?.trim()].filter(Boolean).join('\n\n')
  const chunks = [...chunkText(head)]
  for (const extra of mention.extraTexts) chunks.push(...chunkText(extra))
  return chunks.slice(0, maxChunks)
}

export function transcriptChunks(text: string): string[] {
  return chunkText(text).slice(0, MAX_TRANSCRIPT_CHUNKS)
}

export function totalChars(chunks: readonly string[]): number {
  return chunks.reduce((sum, c) => sum + c.length, 0)
}
