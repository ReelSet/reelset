import type { IngestMode, MentionKind, Source, WatermarkLane } from '@reelset/core'
import type { Logger } from '@reelset/core'

export type NormalizedMention = {
  source: Source
  externalId: string
  kind: MentionKind
  url: string
  /** URL the mention is about. null means the mention is itself the item (self post). */
  linkedUrl: string | null
  title: string
  author: string | null
  body: string | null
  /** points / stars / views depending on source */
  score: number | null
  numComments: number | null
  publishedAt: Date
  /** top comments, README excerpt, etc. Stored in mention.raw.extraTexts and chunked later. */
  extraTexts: string[]
}

export type IngestSettings = {
  redditSubreddits: string[]
  youtubeSearchQueries: string[]
  youtubeMaxAgeDays: number
  youtubeResultsPerQuery: number
  newsFeeds: string[]
}

export type Watermark = {
  source: Source
  scope: string
  lane: WatermarkLane
  newestAt: Date | null
  oldestAt: Date | null
  nextToken: string | null
  backfillComplete: boolean
}

export type FetchRange = {
  after: Date
  before: Date | null
}

export type FetchContext = {
  mode: IngestMode
  range: FetchRange
  maxPages: number
  hostIntervalMs: number
  deadlineAt: number
  now: Date
  githubToken?: string
  render?: Pick<Fetcher, 'fetch'>
  settings: IngestSettings
}

export type AdapterOutcome = {
  mentions: NormalizedMention[]
  exhausted: boolean
}

export type SourceAdapter = {
  source: Source
  scopes: (settings: IngestSettings) => string[]
  /** Incremental runs re-read a rolling window instead of resuming from the watermark. */
  rollingWindowMs?: number
  fetch: (scope: string, log: Logger, ctx: FetchContext) => Promise<AdapterOutcome>
}

export type TaskStatus = 'ok' | 'empty' | 'failed' | 'deferred'

export type TaskOutcome = {
  source: Source
  scope: string
  status: TaskStatus
  fetched: number
  inserted: number
  updated: number
  durationMs: number
  error: string | null
}
