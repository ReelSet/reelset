import { INSTAGRAM_CAPTION_MAX_CHARS, INSTAGRAM_HASHTAG_MAX } from '@/lib/instagram/limits'
import { z } from 'zod'

const HASHTAG_PATTERN = /#[\p{L}\p{N}_]+/gu

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
