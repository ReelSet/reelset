import type { CountRules } from '@/lib/counts'

export type MentionDto = { source: string; score: number | null; url: string }

export const PEXELS_HOME_URL = 'https://www.pexels.com'

export type CreditsDto = {
  stock: { creator: string | null; url: string }[]
  demo: { repo: string; url: string } | null
}

export type FeedItemDto = {
  id: string
  title: string
  tldr: string | null
  transcript: string | null
  topics: string[]
  kind: string
  canonicalUrl: string
  score: number
  publishedAt: string
  videoUrl: string
  posterUrl: string | null
  durationMs: number | null
  likeCount: number
  viewCount: number
  saveCount: number
  liked: boolean
  saved: boolean
  mentions: MentionDto[]
  credits: CreditsDto | null
}

export type FeedResponse = {
  items: FeedItemDto[]
  countRules: CountRules
  nextCursor: string | null
  viewer: { authenticated: boolean; needsTopics: boolean }
}

export type RelatedReelDto = {
  itemId: string
  title: string
  posterUrl: string | null
  source: string
}

export type CitationDto = { chunkId: string; title: string; url: string; publishedAt: string }

export type AskResponse =
  | {
      outcome: 'answered'
      answer: string
      citations: CitationDto[]
      cached: boolean
      reels?: RelatedReelDto[]
    }
  | { outcome: 'no_evidence' | 'rate_limited' | 'spend_capped'; message: string }
  | { outcome: 'error'; message: string; reason?: 'ai_unavailable' }

export type AskStreamEvent =
  { type: 'delta'; text: string } | { type: 'result'; result: AskResponse }

export type ClientEventName =
  | 'feed_view'
  | 'item_open'
  | 'reel_start'
  | 'reel_complete'
  | 'like'
  | 'unlike'
  | 'ask_submit'
  | 'ask_answer_view'
