import { INSTAGRAM_CAPTION_MAX_CHARS, INSTAGRAM_HASHTAG_MAX } from '@/lib/instagram/limits'
import { z } from 'zod'

export const BRAND_HASHTAGS = ['#reelset', '#developers'] as const
export const TOPIC_HASHTAG_MAX = 5
export const MAX_CREDITED_CREATORS = 5
const HASHTAG_PATTERN = /#[\p{L}\p{N}_]+/gu

export type CaptionCredit =
  { kind: 'stock'; creator?: string | null } | { kind: 'demo'; repo?: string }

export type CaptionInput = {
  title: string
  hook: string | null
  tldr: string | null
  canonicalUrl: string
  topics: readonly string[]
  credits: readonly CaptionCredit[]
}

export function topicHashtags(topics: readonly string[], limit = TOPIC_HASHTAG_MAX): string[] {
  const tags = topics
    .map((t) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ''))
    .filter((t) => t.length >= 2 && t.length <= 30)
    .map((t) => `#${t}`)
  return [...new Set(tags)].slice(0, limit)
}

function creditLines(credits: readonly CaptionCredit[]): string[] {
  const creators = [
    ...new Set(credits.flatMap((c) => (c.kind === 'stock' && c.creator ? [c.creator.trim()] : []))),
  ].slice(0, MAX_CREDITED_CREATORS)
  const repos = [...new Set(credits.flatMap((c) => (c.kind === 'demo' && c.repo ? [c.repo] : [])))]
  const lines: string[] = []
  if (creators.length) lines.push(`Stock video by ${creators.join(', ')} on Pexels (pexels.com)`)
  if (repos.length) lines.push(`Demo footage: github.com/${repos[0]}`)
  return lines
}

export function buildCaption(input: CaptionInput): string {
  const lead = (input.hook ?? input.tldr ?? input.title).trim()
  const blocks = [
    lead,
    `Source: ${input.canonicalUrl}`,
    creditLines(input.credits).join('\n'),
    [...topicHashtags(input.topics), ...BRAND_HASHTAGS].join(' '),
  ].filter((b) => b.length > 0)
  const caption = blocks.join('\n\n')
  return caption.length <= INSTAGRAM_CAPTION_MAX_CHARS
    ? caption
    : blocks.slice(0, 1).concat(blocks.slice(-1)).join('\n\n').slice(0, INSTAGRAM_CAPTION_MAX_CHARS)
}

export function normalizeCaption(text: string): string {
  return text.replace(/\r\n?/g, '\n').trim()
}

export function countHashtags(text: string): number {
  return text.match(HASHTAG_PATTERN)?.length ?? 0
}

export type CaptionCheck = { chars: number; hashtags: number; errors: string[] }

export function checkCaption(text: string): CaptionCheck {
  const chars = [...text].length
  const hashtags = countHashtags(text)
  const errors: string[] = []
  if (chars === 0) errors.push('Caption is empty')
  if (chars > INSTAGRAM_CAPTION_MAX_CHARS) {
    errors.push(
      `Caption is ${chars - INSTAGRAM_CAPTION_MAX_CHARS} characters over the ${INSTAGRAM_CAPTION_MAX_CHARS} limit`,
    )
  }
  if (hashtags > INSTAGRAM_HASHTAG_MAX) {
    errors.push(`${hashtags} hashtags; Instagram allows at most ${INSTAGRAM_HASHTAG_MAX}`)
  }
  return { chars, hashtags, errors }
}

export const VIDEO_KEY_MAX_CHARS = 512

export const queuePostSchema = z.object({
  itemId: z.guid(),
  videoKey: z.string().min(1).max(VIDEO_KEY_MAX_CHARS),
  caption: z.string().transform(normalizeCaption),
})

export type QueueValidation =
  { ok: true; itemId: string; videoKey: string; caption: string } | { ok: false; message: string }

export function validateQueueRequest(raw: unknown): QueueValidation {
  const parsed = queuePostSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, message: 'Invalid post request' }
  const check = checkCaption(parsed.data.caption)
  if (check.errors.length) return { ok: false, message: check.errors[0] ?? 'Invalid caption' }
  const { itemId, videoKey, caption } = parsed.data
  return { ok: true, itemId, videoKey, caption }
}

export const credits = {
  parse(raw: unknown): CaptionCredit[] {
    const list = z
      .array(
        z.union([
          z.object({ kind: z.literal('stock'), creator: z.string().nullish() }),
          z.object({ kind: z.literal('demo'), repo: z.string().optional() }),
        ]),
      )
      .safeParse(raw)
    return list.success ? (list.data as CaptionCredit[]) : []
  },
}
