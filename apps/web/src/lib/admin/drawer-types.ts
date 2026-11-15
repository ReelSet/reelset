import type { UserDetail } from '@/server/admin/users'

export type Serialized<T> = T extends Date
  ? string
  : T extends readonly (infer U)[]
    ? Serialized<U>[]
    : T extends object
      ? { [K in keyof T]: Serialized<T[K]> }
      : T

export type ScriptView = {
  hook: string
  beats: { text: string; visualType: string }[]
  outro: string
}

export type ItemDrawerData = {
  now: string
  item: {
    id: string
    title: string
    source: string
    status: string
    attempts: number
    firstSeenAt: string
    canonicalUrl: string
    visibility: string
    hiddenReason: string | null
    hiddenAt: string | null
    lastError: string | null
    lastOkStage: string | null
    tldr: string | null
  }
  retryStage: string
  script: ScriptView | null
  events: {
    stage: string
    outcome: string
    attempt: number
    duration_ms: number | null
    error: string | null
    created_at: string
  }[]
  renders: {
    status: string
    attempts: number
    templateVersion: number | null
    renderMs: number | null
    videoDurationMs: number | null
    bytes: number | null
    hasVideo: boolean
  }[]
  video: { url: string; posterUrl: string | null } | null
  narrationProvider: string | null
  spend: { category: string; costUsd: number; label: string | null }[]
  totalUsd: number
  postedPermalink: string | null
}

export type UserDrawerData = Serialized<UserDetail>

export type ItemPreview = { title?: string; source?: string; status?: string }
export type UserPreview = { name?: string }
