import { CAPTION_H, CONTENT_TOP, CONTENT_W, LOW_BOTTOM, ZONE_H } from '../theme'
import { fitWords } from './typeset'
import type { ItemFacts, ReelProps, Source, TimedShot } from './types'

/** Vertical extent of the safe area a screen is judged against: below the chrome to the bottom safe line. */
export const SAFE_H = LOW_BOTTOM - CONTENT_TOP
/** A screen that covers less than this share of the safe area for longer than `SPARSE_S` looks unfinished. */
export const MIN_FILL = 0.5
export const SPARSE_S = 1.5

/** Height of the context plate under a key point (source chip, item title, one big number). */
export const PLATE_H = 300
export const PLATE_GAP = 44
/** Height of the plate that carries a footage-less, text-less shot on its own. */
export const PLATE_FULL_H = 760

export type TextPlan = { size: number; blockPx: number; plateH: number }

/** Type size and block height of a key point: the text is set as large as the zone above the plate allows. */
export function textPlan(text: string, sub: string, topPad: number, plate = true): TextPlan {
  const plateH = plate ? PLATE_H + PLATE_GAP : 0
  const room = ZONE_H - topPad - plateH - (sub ? 130 : 20)
  const size = fitWords(
    text,
    { width: CONTENT_W - 8, height: Math.max(180, room) },
    { min: 44, max: 220, lineHeight: 1.04 },
  )
  const words = text.split(/\s+/).filter(Boolean)
  const perLine = Math.max(1, Math.floor((CONTENT_W - 8) / (size * 0.62)))
  let lines = 1
  let used = 0
  for (const w of words) {
    const need = [...w].length + (used > 0 ? 1 : 0)
    if (used + need > perLine && used > 0) {
      lines += 1
      used = [...w].length
    } else used += need
  }
  return { size, blockPx: Math.round(lines * size * 1.04 + (sub ? 120 : 0)), plateH }
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')

/**
 * Share of the safe area a shot covers (0-1), for the "no screen leaves more than half of it empty"
 * rule. Footage, images, cards and charts fill the frame by design; a key point is its text block,
 * the context plate and the caption band (a text-less, footage-less shot is the plate alone).
 */
export function fillShare(shot: Pick<TimedShot, 'show' | 'props'>, topPad = 0): number {
  if (shot.show !== 'KeyPoint') return 1
  const p = shot.props
  if (typeof p.bg === 'number' || p.hook === true) return 1
  if (Array.isArray(p.items)) return 0.7
  if (p.quote) return 0.8
  const text = str(p.text).trim()
  const bare = p.bare === true
  const covered = text
    ? textPlan(text, str(p.sub), topPad, !bare).blockPx + (bare ? 0 : PLATE_H) + CAPTION_H
    : PLATE_FULL_H + CAPTION_H
  return Math.min(1, covered / SAFE_H)
}

export type SparseShot = { from: number; seconds: number; share: number }

/** Shots that leave over half of the safe area empty for more than 1.5 s. */
export function sparseShots(
  shots: readonly TimedShot[],
  fps: number,
  headlineFrames = 0,
): SparseShot[] {
  return shots.flatMap((s) => {
    const share = fillShare(s, s.from < headlineFrames ? 270 : 0)
    const seconds = s.frames / fps
    return share < MIN_FILL && seconds > SPARSE_S ? [{ from: s.from / fps, seconds, share }] : []
  })
}

export type PlateFact = { value: string; label: string }

const compactNumber = (n: number): string =>
  n >= 10_000
    ? `${Math.round(n / 1000)}k`
    : n >= 1000
      ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
      : String(n)

/** The one number the plate shows big, from real item facts only; null when there is none. */
export function plateFact(source: Source, facts: ItemFacts): PlateFact | null {
  if (source === 'github' && facts.repo?.stars)
    return { value: compactNumber(facts.repo.stars), label: 'stars' }
  if (source === 'hn' && facts.hn?.points)
    return { value: compactNumber(facts.hn.points), label: 'points' }
  if (source === 'reddit' && facts.reddit?.upvotes)
    return { value: compactNumber(facts.reddit.upvotes), label: 'upvotes' }
  if (source === 'papers' && facts.paper?.upvotes)
    return { value: compactNumber(facts.paper.upvotes), label: 'upvotes' }
  if (source === 'youtube' && facts.youtube?.views)
    return { value: compactNumber(facts.youtube.views), label: 'views' }
  return null
}

export const plateSource = (props: Pick<ReelProps, 'domain' | 'sourceLabel'>): string =>
  props.sourceLabel || props.domain
