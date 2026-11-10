export const Source = {
  hn: 'hn',
  github: 'github',
  news: 'news',
  reddit: 'reddit',
  youtube: 'youtube',
  papers: 'papers',
} as const
export type Source = (typeof Source)[keyof typeof Source]
export const ItemKind = {
  repo: 'repo',
  video: 'video',
  article: 'article',
  discussion: 'discussion',
} as const
export type ItemKind = (typeof ItemKind)[keyof typeof ItemKind]
export const ItemStatus = {
  found: 'found',
  summarized: 'summarized',
  embedded: 'embedded',
  voiced: 'voiced',
  rendered: 'rendered',
  insufficient_source: 'insufficient_source',
  failed: 'failed',
} as const
export type ItemStatus = (typeof ItemStatus)[keyof typeof ItemStatus]
export const MentionKind = {
  post: 'post',
  comment: 'comment',
  video: 'video',
  repo: 'repo',
  article: 'article',
} as const
export type MentionKind = (typeof MentionKind)[keyof typeof MentionKind]
export const StageOutcome = {
  started: 'started',
  ok: 'ok',
  failed: 'failed',
  skipped: 'skipped',
} as const
export type StageOutcome = (typeof StageOutcome)[keyof typeof StageOutcome]
export const RenderStatus = {
  queued: 'queued',
  rendering: 'rendering',
  done: 'done',
  failed: 'failed',
} as const
export type RenderStatus = (typeof RenderStatus)[keyof typeof RenderStatus]
export const IngestRunStatus = {
  running: 'running',
  done: 'done',
  failed: 'failed',
} as const
export type IngestRunStatus = (typeof IngestRunStatus)[keyof typeof IngestRunStatus]
export const IngestTaskStatus = {
  queued: 'queued',
  running: 'running',
  ok: 'ok',
  empty: 'empty',
  failed: 'failed',
  deferred: 'deferred',
} as const
export type IngestTaskStatus = (typeof IngestTaskStatus)[keyof typeof IngestTaskStatus]
export const IngestMode = {
  incremental: 'incremental',
  backfill: 'backfill',
} as const
export type IngestMode = (typeof IngestMode)[keyof typeof IngestMode]
export const WatermarkLane = {
  default: 'default',
  discover: 'discover',
  sweep: 'sweep',
} as const
export type WatermarkLane = (typeof WatermarkLane)[keyof typeof WatermarkLane]
export const UserRole = {
  user: 'user',
  admin: 'admin',
} as const
export type UserRole = (typeof UserRole)[keyof typeof UserRole]
export const EventName = {
  feed_view: 'feed_view',
  item_open: 'item_open',
  reel_start: 'reel_start',
  reel_complete: 'reel_complete',
  like: 'like',
  unlike: 'unlike',
  ask_submit: 'ask_submit',
  ask_answer_view: 'ask_answer_view',
} as const
export type EventName = (typeof EventName)[keyof typeof EventName]
export const AskOutcome = {
  answered: 'answered',
  no_evidence: 'no_evidence',
  rate_limited: 'rate_limited',
  spend_capped: 'spend_capped',
  error: 'error',
} as const
export type AskOutcome = (typeof AskOutcome)[keyof typeof AskOutcome]
export const SpendCategory = {
  llm: 'llm',
  embedding: 'embedding',
  tts: 'tts',
  render: 'render',
  storage: 'storage',
  ask: 'ask',
  scrape: 'scrape',
} as const
export type SpendCategory = (typeof SpendCategory)[keyof typeof SpendCategory]
export const InstagramPostStatus = {
  draft: 'draft',
  queued: 'queued',
  posting: 'posting',
  posted: 'posted',
  failed: 'failed',
  deleting: 'deleting',
  deleted: 'deleted',
} as const
export type InstagramPostStatus = (typeof InstagramPostStatus)[keyof typeof InstagramPostStatus]
