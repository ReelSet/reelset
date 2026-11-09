import type { ItemStatus } from '@reelset/core'
import { MIN_EVIDENCE_CHARS, QUEUE_MAX_RETRIES } from '../config'
import { mentionChunks, totalChars, transcriptChunks } from '../chunk'

export type Stage = 'summarize' | 'embed' | 'enqueue_render' | 'skip'

export function stageFor(status: ItemStatus): Stage {
  switch (status) {
    case 'found':
      return 'summarize'
    case 'summarized':
      return 'embed'
    case 'embedded':
      return 'enqueue_render'
    default:
      return 'skip'
  }
}

export function decideOnError(
  deliveryAttempt: number,
  maxRetries = QUEUE_MAX_RETRIES,
): 'retry' | 'fail' {
  return deliveryAttempt > maxRetries ? 'fail' : 'retry'
}

export function retryDelaySeconds(deliveryAttempt: number): number {
  return Math.min(600, 30 * 2 ** Math.max(0, deliveryAttempt - 1))
}

export function youtubeIdFromKey(canonicalKey: string): string | null {
  return canonicalKey.startsWith('youtube:') ? canonicalKey.slice('youtube:'.length) : null
}

export type MentionForEvidence = {
  id: string
  source: string
  title: string | null
  body: string | null
  extraTexts: readonly string[]
}

export type EvidenceRow = { mentionId: string; chunkIndex: number; text: string }

export function buildEvidenceRows(
  mentions: readonly MentionForEvidence[],
  transcript: string | null,
): EvidenceRow[] {
  const rows: EvidenceRow[] = []
  const transcriptOwner =
    transcript === null ? null : (mentions.find((m) => m.source === 'youtube') ?? mentions[0])
  for (const mention of mentions) {
    const texts = mentionChunks(mention)
    if (transcript !== null && transcriptOwner?.id === mention.id) {
      texts.push(...transcriptChunks(transcript))
    }
    texts.forEach((text, index) => rows.push({ mentionId: mention.id, chunkIndex: index, text }))
  }
  return rows
}

export function hasEnoughEvidence(rows: readonly EvidenceRow[]): boolean {
  return totalChars(rows.map((r) => r.text)) >= MIN_EVIDENCE_CHARS
}

export function parseExtraTexts(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object') return []
  const extra = (raw as { extraTexts?: unknown }).extraTexts
  return Array.isArray(extra) ? extra.filter((t): t is string => typeof t === 'string') : []
}

export const MAX_PROMPT_CHUNKS = 40
export const MAX_PROMPT_CHARS = 28_000

export function selectPromptChunks<T extends { text: string }>(chunks: readonly T[]): T[] {
  const out: T[] = []
  let chars = 0
  for (const chunk of chunks) {
    if (out.length >= MAX_PROMPT_CHUNKS || chars + chunk.text.length > MAX_PROMPT_CHARS) break
    out.push(chunk)
    chars += chunk.text.length
  }
  return out
}
