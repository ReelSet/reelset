import type { ItemStatus, ReelScript, RenderStatus, Source } from '@reelset/core'
import {
  CONTAINER_USD_PER_SECOND,
  DEAD_LETTER_ALERT_MIN,
  FAILURE_RATE_MIN_RENDERS,
  FAILURE_RATE_THRESHOLD,
  MAX_RETRIES,
  ORPHAN_MIN_AGE_MS,
  RETRY_BASE_DELAY_SECONDS,
} from './constants'
import { RenderJobError, isRetryable, type RenderErrorCode } from './errors'

export type ExistingRender = {
  status: RenderStatus
  videoKey: string | null
  posterKey: string | null
}

export type RenderAction =
  { kind: 'skip'; reason: string } | { kind: 'finish' } | { kind: 'render' }

export function decideRenderAction(
  itemStatus: ItemStatus,
  render: ExistingRender | null,
): RenderAction {
  if (itemStatus !== 'embedded' && itemStatus !== 'voiced' && itemStatus !== 'rendered') {
    return { kind: 'skip', reason: `item status is ${itemStatus}` }
  }
  if (render?.status === 'done' && render.videoKey && render.posterKey) return { kind: 'finish' }
  return { kind: 'render' }
}

export type FailureDecision = {
  code: RenderErrorCode
  terminal: boolean
  deadLetter: boolean
  retryDelaySeconds: number
}

export function retryDelaySeconds(attempts: number): number {
  return RETRY_BASE_DELAY_SECONDS * Math.max(1, attempts)
}

export function classifyFailure(err: unknown, attempts: number): FailureDecision {
  const code: RenderErrorCode = err instanceof RenderJobError ? err.code : 'container_unreachable'
  const lastAttempt = attempts > MAX_RETRIES
  const terminal = !isRetryable(code) || lastAttempt
  return {
    code,
    terminal,
    deadLetter: terminal && lastAttempt,
    retryDelaySeconds: retryDelaySeconds(attempts),
  }
}

export function renderCostUsd(renderSeconds: number): number {
  return Number((Math.max(0, renderSeconds) * CONTAINER_USD_PER_SECOND).toFixed(6))
}

const SOURCE_LABELS: Record<Source, string> = {
  hn: 'Hacker News',
  github: 'GitHub',
  news: 'News',
  reddit: 'Reddit',
  youtube: 'YouTube',
  papers: 'Research',
}

export function sourceLabel(source: Source | null): string {
  return source ? SOURCE_LABELS[source] : 'Dev'
}

export function collectImageUrls(script: ReelScript): string[] {
  const urls = script.beats.flatMap((beat) =>
    beat.visual.type === 'image' && beat.visual.url.startsWith('https://') ? [beat.visual.url] : [],
  )
  return [...new Set(urls)]
}

export type KeyedObject = { key: string; uploaded: Date }

export function findOrphanKeys(
  objects: readonly KeyedObject[],
  doneKeys: ReadonlySet<string>,
  now: Date,
): string[] {
  const cutoff = now.getTime() - ORPHAN_MIN_AGE_MS
  return objects
    .filter((o) => o.uploaded.getTime() < cutoff && !doneKeys.has(o.key))
    .map((o) => o.key)
}

export function stuckCutoff(now: Date, minutes: number): Date {
  return new Date(now.getTime() - minutes * 60_000)
}

export function retentionCutoff(now: Date, retentionDays: number): Date {
  return new Date(now.getTime() - retentionDays * 24 * 60 * 60_000)
}

export type RenderCounts = { total: number; failed: number }

export function failureRateExceeded(counts: RenderCounts): boolean {
  if (counts.total < FAILURE_RATE_MIN_RENDERS) return false
  return counts.failed / counts.total > FAILURE_RATE_THRESHOLD
}

export function deadLetterGrowing(deadLettered: number): boolean {
  return deadLettered >= DEAD_LETTER_ALERT_MIN
}

const GITHUB_PATH = /^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/

function parseUrl(value: string | null | undefined): URL | null {
  if (!value) return null
  try {
    return new URL(value)
  } catch {
    return null
  }
}

export function youtubeVideoId(value: string | null | undefined): string | null {
  const url = parseUrl(value)
  if (!url) return null
  const host = url.hostname.replace(/^www\./, '')
  let id: string | null = null
  if (host === 'youtu.be') id = url.pathname.slice(1)
  else if (host === 'youtube.com' || host === 'm.youtube.com') {
    id =
      url.searchParams.get('v') ??
      /^\/(?:shorts|embed|live)\/([^/]+)/.exec(url.pathname)?.[1] ??
      null
  }
  return id && YOUTUBE_ID.test(id) ? id : null
}

/** Direct image URLs for the item's own source, tried in order; other sources use og:image in the container. */
export function sourceImageUrls(
  source: Source | null,
  urls: ReadonlyArray<string | null | undefined>,
): string[] {
  if (source === 'github') {
    for (const value of urls) {
      const url = parseUrl(value)
      if (url?.hostname !== 'github.com') continue
      const match = GITHUB_PATH.exec(url.pathname)
      if (match) return [`https://opengraph.githubassets.com/1/${match[1]}/${match[2]}`]
    }
  }
  if (source === 'youtube') {
    for (const value of urls) {
      const id = youtubeVideoId(value)
      if (id) {
        return [
          `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`,
          `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
        ]
      }
    }
  }
  return []
}
