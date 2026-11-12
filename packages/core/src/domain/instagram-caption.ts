import { z } from 'zod'
import { INSTAGRAM_CAPTION_MAX_CHARS } from './instagram-post'

export const BRAND_HASHTAGS = ['#reelset', '#developers'] as const
export const TOPIC_HASHTAG_MAX = 5
export const MAX_CREDITED_CREATORS = 5

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

/** The default Instagram caption for a reel: hook, source, credits, hashtags. */
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

const captionCreditsSchema = z.array(
  z.union([
    z.object({ kind: z.literal('stock'), creator: z.string().nullish() }),
    z.object({ kind: z.literal('demo'), repo: z.string().optional() }),
  ]),
)

/** Render credits from the `render.credits` JSON column; anything malformed reads as none. */
export function parseCaptionCredits(raw: unknown): CaptionCredit[] {
  const list = captionCreditsSchema.safeParse(raw)
  return list.success ? (list.data as CaptionCredit[]) : []
}
