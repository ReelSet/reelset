import type { BrollClip, ScreenName, TimedShot } from './types'

/** Screens that play a muted stock clip under a dark scrim. */
export const BG_SCREENS = new Set<ScreenName>(['KeyPoint', 'StatSlam', 'Compare', 'EndCard'])

export const BG_OPACITY = 0.4

const CAPTION_PIECE_S = 2.5
const SPARE_CLIPS = 2
const FRAME_RATE = 30

/** Clip indexes that more than one shot shows (always empty for a valid plan). */
export function repeatedClips(shots: readonly Pick<TimedShot, 'props'>[]): number[] {
  const seen = new Set<number>()
  const dup = new Set<number>()
  for (const s of shots) {
    const bg = s.props.bg
    if (typeof bg !== 'number') continue
    if (seen.has(bg)) dup.add(bg)
    seen.add(bg)
  }
  return [...dup]
}

/** Safety net: a clip already shown by an earlier shot is dropped from a later one. */
export function dropRepeatedClips(shots: TimedShot[]): TimedShot[] {
  const seen = new Set<number>()
  return shots.map((s) => {
    const bg = s.props.bg
    if (typeof bg !== 'number') return s
    if (!seen.has(bg)) {
      seen.add(bg)
      return s
    }
    return { ...s, props: { ...s.props, bg: undefined } }
  })
}

/**
 * Gives eligible shots a `bg` clip index. Each clip is used once per reel; a clip made for a beat
 * goes to a shot of that beat when one is free, and the clips spread over the reel rather than
 * bunching at the start.
 */
export function assignBroll(
  shots: TimedShot[],
  clips: readonly BrollClip[] | undefined,
): TimedShot[] {
  if (!clips || clips.length === 0) return shots
  const taken = new Set<number>(
    shots.flatMap((s) => (typeof s.props.bg === 'number' ? [s.props.bg] : [])),
  )
  const isEmpty = (s: TimedShot) =>
    s.show === 'KeyPoint' && !s.props.quote && !s.props.text && typeof s.props.bg !== 'number'
  const must = shots.map((s, i) => (isEmpty(s) ? i : -1)).filter((i) => i >= 0)
  const eligible = shots
    .map((s, i) =>
      BG_SCREENS.has(s.show) && typeof s.props.bg !== 'number' && !isEmpty(s) ? i : -1,
    )
    .filter((i) => i >= 0)
  const free = Math.max(0, clips.length - taken.size)
  const forced = must.slice(0, free)
  // An empty shot held past 2.9 s is cut into pieces that each need a clip of their own.
  const pieces = must.reduce(
    (n, i) => n + Math.max(0, Math.ceil(shots[i]!.frames / (CAPTION_PIECE_S * FRAME_RATE)) - 1),
    0,
  )
  // Two clips stay free for the passes after this one (a cut that needs footage, the hook's second shot).
  const n = Math.max(0, Math.min(free - forced.length - pieces - SPARE_CLIPS, eligible.length))
  const spread =
    n > 0
      ? Array.from(
          { length: n },
          (_, k) => eligible[Math.floor(((k + 0.5) * eligible.length) / n)]!,
        )
      : []
  const chosen = [...forced, ...spread]
  const bg = new Map<number, number>()
  for (const at of chosen) {
    const scene = shots[at]!.sceneIndex
    const match = clips.findIndex((c, ci) => !taken.has(ci) && c.beat === scene)
    const ci = match >= 0 ? match : clips.findIndex((_, k) => !taken.has(k))
    if (ci < 0) break
    taken.add(ci)
    bg.set(at, ci)
  }
  if (bg.size === 0) return shots
  return shots.map((s, i) => (bg.has(i) ? { ...s, props: { ...s.props, bg: bg.get(i) } } : s))
}
