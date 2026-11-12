export type ReelFactSource = { url: string; title: string }
export type ReelFact = { text: string; sources: ReelFactSource[] }

export type ReelMention = {
  source: string
  url: string
  title: string | null
  author: string | null
  score: number | null
  comments: number | null
}

/** Everything a public reel page shows; video and poster are null once retention removed them. */
export type ReelPageData = {
  id: string
  title: string
  tldr: string | null
  hook: string | null
  transcript: string | null
  topics: string[]
  kind: string
  canonicalUrl: string
  publishedAt: string
  renderedAt: string | null
  videoUrl: string | null
  posterUrl: string | null
  durationMs: number | null
  facts: ReelFact[]
  mentions: ReelMention[]
}

export type ReelSummary = {
  id: string
  title: string
  tldr: string | null
  topics: string[]
  publishedAt: string
  updatedAt: string
  videoUrl: string | null
  posterUrl: string | null
  durationMs: number | null
}

export type TopicCount = { slug: string; label: string; count: number }
