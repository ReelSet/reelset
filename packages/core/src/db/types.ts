import type { ColumnType } from 'kysely'
export type Generated<T> =
  T extends ColumnType<infer S, infer I, infer U>
    ? ColumnType<S, I | undefined, U>
    : ColumnType<T, T | undefined, T>
export type Timestamp = ColumnType<Date, Date | string, Date | string>

import type {
  Source,
  ItemKind,
  ItemStatus,
  MentionKind,
  StageOutcome,
  RenderStatus,
  IngestRunStatus,
  IngestTaskStatus,
  IngestMode,
  WatermarkLane,
  UserRole,
  EventName,
  AskOutcome,
  SpendCategory,
  InstagramPostStatus,
} from './enums'

export type AppSetting = {
  key: string
  value: unknown
  updated_at: Generated<Timestamp>
}
export type AskQuery = {
  id: Generated<string>
  profile_id: string | null
  question: string
  normalized_question: string
  answer: string | null
  citations: unknown | null
  outcome: AskOutcome
  latency_ms: number | null
  input_tokens: number | null
  output_tokens: number | null
  conversation_id: string | null
  cached: Generated<boolean>
  deleted_at: Timestamp | null
  created_at: Generated<Timestamp>
}
export type BoxSample = {
  id: Generated<string>
  box: string
  at: Generated<Timestamp>
  ok: boolean
  running: Generated<number>
  inflight: Generated<number>
  idle_seconds: number | null
  cpu_pct: number | null
  load1: number | null
  mem_used_mb: number | null
  swap_used_mb: number | null
}
export type DirectorSkill = {
  id: Generated<string>
  name: string
  kind: Generated<string>
  content: string
  enabled: Generated<boolean>
  sort: Generated<number>
  created_at: Generated<Timestamp>
  updated_at: Generated<Timestamp>
}
export type Event = {
  id: Generated<string>
  profile_id: string | null
  session_id: string
  name: EventName
  item_id: string | null
  meta: unknown | null
  created_at: Generated<Timestamp>
}
export type EvidenceChunk = {
  id: Generated<string>
  item_id: string
  mention_id: string
  chunk_index: number
  text: string
  created_at: Generated<Timestamp>
}
export type IngestRun = {
  id: Generated<string>
  mode: Generated<IngestMode>
  started_at: Generated<Timestamp>
  heartbeat_at: Generated<Timestamp>
  finished_at: Timestamp | null
  status: Generated<IngestRunStatus>
  result: unknown | null
}
export type IngestTask = {
  id: Generated<string>
  run_id: string
  position: number
  source: Source
  scope: Generated<string>
  status: Generated<IngestTaskStatus>
  fetched: Generated<number>
  inserted: Generated<number>
  updated: Generated<number>
  duration_ms: Generated<number>
  error: string | null
  started_at: Timestamp | null
  finished_at: Timestamp | null
}
export type InstagramPost = {
  id: Generated<string>
  item_id: string
  video_key: string
  caption: string
  status: Generated<InstagramPostStatus>
  media_pk: string | null
  permalink: string | null
  error: string | null
  attempts: Generated<number>
  requested_by: string | null
  created_at: Generated<Timestamp>
  started_at: Timestamp | null
  posted_at: Timestamp | null
  delete_requested_at: Timestamp | null
  updated_at: Generated<Timestamp>
}
export type Item = {
  id: Generated<string>
  canonical_key: string
  canonical_url: string
  kind: ItemKind
  title: string
  topics: Generated<string[]>
  status: Generated<ItemStatus>
  score: Generated<number>
  tldr: string | null
  script: unknown | null
  images: unknown | null
  demo: unknown | null
  content_hash: string | null
  prompt_version: string | null
  attempts: Generated<number>
  last_error: string | null
  published_at: Timestamp
  first_seen_at: Generated<Timestamp>
  status_changed_at: Generated<Timestamp>
  rendered_at: Timestamp | null
  queued_at: Timestamp | null
  created_at: Generated<Timestamp>
  updated_at: Generated<Timestamp>
}
export type ItemEvent = {
  id: Generated<string>
  item_id: string
  stage: ItemStatus
  outcome: StageOutcome
  attempt: Generated<number>
  duration_ms: number | null
  error: string | null
  meta: unknown | null
  created_at: Generated<Timestamp>
}
export type Like = {
  profile_id: string
  item_id: string
  created_at: Generated<Timestamp>
}
export type Mention = {
  id: Generated<string>
  item_id: string
  source: Source
  kind: MentionKind
  external_id: string
  url: string
  title: string | null
  author: string | null
  body: string | null
  score: number | null
  num_comments: number | null
  published_at: Timestamp
  fetched_at: Generated<Timestamp>
  scored_at: Timestamp | null
  raw: unknown | null
}
export type Profile = {
  id: string
  role: Generated<UserRole>
  topics: Generated<string[]>
  sources: Generated<string[]>
  signal_count: Generated<number>
  created_at: Generated<Timestamp>
  updated_at: Generated<Timestamp>
}
export type Render = {
  id: Generated<string>
  item_id: string
  render_key: string
  status: Generated<RenderStatus>
  video_key: string | null
  poster_key: string | null
  bytes: number | null
  video_duration_ms: number | null
  render_ms: number | null
  attempts: Generated<number>
  error: string | null
  template_version: number | null
  credits: unknown | null
  box: string | null
  director: unknown | null
  created_at: Generated<Timestamp>
  started_at: Timestamp | null
  finished_at: Timestamp | null
}
export type Save = {
  profile_id: string
  item_id: string
  created_at: Generated<Timestamp>
}
export type SourceWatermark = {
  source: Source
  scope: Generated<string>
  lane: Generated<WatermarkLane>
  newest_at: Timestamp | null
  oldest_at: Timestamp | null
  next_token: string | null
  backfill_complete: Generated<boolean>
  updated_at: Generated<Timestamp>
}
export type SpendLedger = {
  id: Generated<string>
  day: Timestamp
  category: SpendCategory
  units: string
  cost_usd: string
  meta: unknown | null
  created_at: Generated<Timestamp>
}
export type DB = {
  app_setting: AppSetting
  ask_query: AskQuery
  box_sample: BoxSample
  director_skill: DirectorSkill
  event: Event
  evidence_chunk: EvidenceChunk
  ingest_run: IngestRun
  ingest_task: IngestTask
  instagram_post: InstagramPost
  item: Item
  item_event: ItemEvent
  like: Like
  mention: Mention
  profile: Profile
  render: Render
  save: Save
  source_watermark: SourceWatermark
  spend_ledger: SpendLedger
}
