import type { Source } from '@reelset/core'

export type ScoreSignal = {
  source: Source
  score: number | null
  numComments: number | null
  publishedAt: Date
}

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
const DECAY_HALF_LIFE_HOURS = 72
const DECAY_FLOOR = 0.25
const NEWS_BASE = 0.65
const EXTRA_MENTION_BONUS = 0.05
const EXTRA_MENTION_BONUS_CAP = 4
const COMMENT_WEIGHT = 0.5
// arXiv-only papers carry no engagement signal yet: below the default admission floor.
const UNRANKED_PAPER_BASE = 0.25

// Log-engagement (see engagement()) mapped linearly to 0..1: `floor` is a typical weak item of that
// source, `top` a standout one, both calibrated on each source's own recent distribution.
const RANGE: Record<Exclude<Source, 'news'>, { floor: number; top: number }> = {
  hn: { floor: 4, top: 9 },
  reddit: { floor: 3, top: 8.5 },
  github: { floor: 3.5, top: 7 },
  youtube: { floor: 5.5, top: 9.5 },
  // Hugging Face Daily Papers: a handful of upvotes is typical, 150+ is a standout.
  papers: { floor: 1.5, top: 6.2 },
}

// Votes plus discussion for hn/reddit; per-day velocity for github (stars) and youtube (views),
// so a week-old video is not compared with a day-old one on raw totals.
export function engagement(signal: ScoreSignal, now: Date): number {
  const points = Math.max(0, signal.score ?? 0)
  const ageDays = Math.max((now.getTime() - signal.publishedAt.getTime()) / DAY_MS, 0)
  switch (signal.source) {
    case 'github':
      return Math.log1p(points / Math.max(ageDays, 1))
    case 'youtube':
      return Math.log1p(points / Math.max(ageDays, 0.5))
    default:
      return Math.log1p(points) + COMMENT_WEIGHT * Math.log1p(Math.max(0, signal.numComments ?? 0))
  }
}

export function recencyDecay(publishedAt: Date, now: Date): number {
  const ageHours = Math.max(0, (now.getTime() - publishedAt.getTime()) / HOUR_MS)
  return Math.max(DECAY_FLOOR, 0.5 ** (ageHours / DECAY_HALF_LIFE_HOURS))
}

export function mentionScore(signal: ScoreSignal, now: Date): number {
  const velocity = signal.source === 'github' || signal.source === 'youtube'
  const decay = velocity ? 1 : recencyDecay(signal.publishedAt, now)
  if (signal.source === 'news') return NEWS_BASE * decay

  if (signal.source === 'papers' && signal.score === null) return UNRANKED_PAPER_BASE * decay

  const { floor, top } = RANGE[signal.source]
  const normalized = (engagement(signal, now) - floor) / (top - floor)
  return Math.min(1, Math.max(0, normalized)) * decay
}

export function primarySource(signals: readonly ScoreSignal[], now: Date): Source | null {
  let best: { source: Source; score: number } | null = null
  for (const s of signals) {
    const score = mentionScore(s, now)
    if (!best || score > best.score) best = { source: s.source, score }
  }
  return best?.source ?? null
}

export function itemScore(signals: readonly ScoreSignal[], now: Date): number {
  if (signals.length === 0) return 0
  const best = Math.max(...signals.map((s) => mentionScore(s, now)))
  const bonus = EXTRA_MENTION_BONUS * Math.min(signals.length - 1, EXTRA_MENTION_BONUS_CAP)
  return Math.min(1, Math.round((best + bonus) * 10_000) / 10_000)
}
