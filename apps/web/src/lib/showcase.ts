import { reelPath } from '@/lib/reel-url'

export const SHOWCASE_COUNT = 3
export const SHOWCASE_PREVIEW_SECONDS = 3
const PREVIEW_BYTE_HEADROOM = 1.0
const PREVIEW_MIN_BYTES = 256 * 1024
export const PLAY_RATIO = 0.6
const MAX_TITLE_CHARS = 90
// GitHub is left out: its feed is the one most polluted by spam, and the landing page is a storefront.
export const SHOWCASE_SOURCES = ['hn', 'reddit', 'youtube', 'news', 'papers'] as const

export type ShowcaseCandidate = {
  id: string
  title: string
  source: string
  score: number
  video_key: string
  poster_key: string | null
  thumb_key: string | null
  video_duration_ms: number | null
}

export type ShowcaseReel = {
  id: string
  title: string
  source: string
  href: string
  videoUrl: string
  previewUrl: string
  posterUrl: string | null
  thumbUrl: string | null
  durationMs: number | null
}

/** Best-scoring candidate per allowed source, taking sources in preference order; fewer than `limit` yields []. */
export function pickShowcase(
  candidates: readonly ShowcaseCandidate[],
  mediaUrl: (key: string) => string,
  limit = SHOWCASE_COUNT,
): ShowcaseReel[] {
  const bestBySource = new Map<string, ShowcaseCandidate>()
  for (const c of candidates) {
    if (!c.title.trim() || c.title.length > MAX_TITLE_CHARS) continue
    const best = bestBySource.get(c.source)
    if (!best || c.score > best.score) bestBySource.set(c.source, c)
  }
  const picked = SHOWCASE_SOURCES.flatMap((source) => bestBySource.get(source) ?? []).slice(
    0,
    limit,
  )
  if (picked.length < limit) return []
  return picked.map((c) => ({
    id: c.id,
    title: c.title.trim(),
    source: c.source,
    href: reelPath(c),
    videoUrl: mediaUrl(c.video_key),
    previewUrl: `/api/showcase/${c.id}/preview`,
    posterUrl: c.poster_key ? mediaUrl(c.poster_key) : null,
    thumbUrl: c.thumb_key ? mediaUrl(c.thumb_key) : null,
    durationMs: c.video_duration_ms,
  }))
}

/** "0:42" for a duration in ms, or null when unknown. */
export function formatDuration(ms: number | null): string | null {
  if (ms === null || !Number.isFinite(ms) || ms <= 0) return null
  const total = Math.round(ms / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/** Indices that should play: every sufficiently visible card, or only the most visible on mobile. */
export function playingIndices(ratios: readonly number[], singleOnly: boolean): Set<number> {
  const visible = ratios.flatMap((r, i) => (r >= PLAY_RATIO ? [i] : []))
  if (!singleOnly || visible.length <= 1) return new Set(visible)
  const best = visible.reduce((a, b) => (ratios[b]! > ratios[a]! ? b : a))
  return new Set([best])
}

/** Bytes of the MP4 head covering about `seconds` of video (moov leads the file), capped at the file size. */
export function previewByteLimit(
  totalBytes: number,
  durationMs: number | null,
  seconds = SHOWCASE_PREVIEW_SECONDS,
): number {
  if (!durationMs || durationMs <= 0) return Math.min(totalBytes, PREVIEW_MIN_BYTES * 4)
  const share = Math.min((seconds * 1000) / durationMs, 1)
  const estimate = Math.ceil(totalBytes * share * PREVIEW_BYTE_HEADROOM)
  return Math.min(totalBytes, Math.max(estimate, PREVIEW_MIN_BYTES))
}
