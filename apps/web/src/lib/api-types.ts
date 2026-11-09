export type MentionDto = { source: string; score: number | null; url: string }

export type FeedItemDto = {
  id: string
  title: string
  tldr: string | null
  topics: string[]
  kind: string
  canonicalUrl: string
  score: number
  publishedAt: string
  videoUrl: string
  posterUrl: string | null
  durationMs: number | null
  likeCount: number
  liked: boolean
  mentions: MentionDto[]
}

export type FeedResponse = {
  items: FeedItemDto[]
  nextCursor: string | null
  viewer: { authenticated: boolean; needsTopics: boolean }
}

export type CitationDto = { chunkId: string; title: string; url: string; publishedAt: string }

export type AskResponse =
  | { outcome: 'answered'; answer: string; citations: CitationDto[]; cached: boolean }
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
