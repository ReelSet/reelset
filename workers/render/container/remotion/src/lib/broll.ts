import type { BrollClip, ScreenName, TimedShot } from './types'

/** Screens that play a muted stock clip under a dark scrim. */
export const BG_SCREENS = new Set<ScreenName>(['KeyPoint', 'StatSlam', 'Compare', 'EndCard'])

export const BG_OPACITY = 0.4

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
  const n = Math.min(free - forced.length, eligible.length)
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
  const reuse = new Map<number, number>()
  const near = (i: number, ci: number) =>
    shots.some(
      (s, k) =>
        Math.abs(k - i) <= 3 && (s.props.bg === ci || bg.get(k) === ci || reuse.get(k) === ci),
    )
  for (const at of must.filter((i) => !bg.has(i))) {
    const ci = clips.findIndex((_, k) => !near(at, k))
    if (ci >= 0) reuse.set(at, ci)
  }
  if (bg.size === 0 && reuse.size === 0) return shots
  return shots.map((s, i) =>
    bg.has(i)
      ? { ...s, props: { ...s.props, bg: bg.get(i) } }
      : reuse.has(i)
        ? { ...s, props: { ...s.props, bg: reuse.get(i), bgAt: REUSE_OFFSET_S } }
        : s,
  )
}

/** A clip shown a second time (only for an otherwise empty shot) starts this far in, so it looks different. */
export const REUSE_OFFSET_S = 3
