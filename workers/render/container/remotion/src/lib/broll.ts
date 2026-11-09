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
  const eligible = shots
    .map((s, i) => (BG_SCREENS.has(s.show) && typeof s.props.bg !== 'number' ? i : -1))
    .filter((i) => i >= 0)
  if (eligible.length === 0) return shots
  const n = Math.min(clips.length - taken.size, eligible.length)
  if (n <= 0) return shots
  const chosen = Array.from(
    { length: n },
    (_, k) => eligible[Math.floor(((k + 0.5) * eligible.length) / n)]!,
  )
  const bg = new Map<number, number>()
  for (const at of chosen) {
    const scene = shots[at]!.sceneIndex
    const match = clips.findIndex((c, ci) => !taken.has(ci) && c.beat === scene)
    const ci = match >= 0 ? match : clips.findIndex((_, k) => !taken.has(k))
    if (ci < 0) break
    taken.add(ci)
    bg.set(at, ci)
  }
  return shots.map((s, i) => (bg.has(i) ? { ...s, props: { ...s.props, bg: bg.get(i) } } : s))
}
