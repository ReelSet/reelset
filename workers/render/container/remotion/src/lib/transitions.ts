import type { ScreenName } from './types'

export const TRANSITIONS = ['punch', 'slide', 'whip', 'cut', 'rise'] as const
export type TransitionName = (typeof TRANSITIONS)[number]

/** Frames the previous shot stays underneath a moving-in shot. */
export const TRANSITION_FRAMES: Record<TransitionName, number> = {
  punch: 0,
  slide: 8,
  whip: 7,
  cut: 0,
  rise: 8,
}

const hash = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 11)

/** Deterministic per (position, screen); never repeats the previous cut and flashes on punch only. */
export function pickTransitions(shows: readonly ScreenName[]): (TransitionName | null)[] {
  const out: (TransitionName | null)[] = []
  shows.forEach((show, i) => {
    if (i === 0) {
      out.push(null)
      return
    }
    const prev = out[i - 1]
    let k = hash(`${i}:${show}`) % TRANSITIONS.length
    if (TRANSITIONS[k] === prev) k = (k + 1) % TRANSITIONS.length
    out.push(TRANSITIONS[k]!)
  })
  return out
}

/** Frames a shot's sequence is extended so the next (moving) shot can slide over it. */
export function overlapFrames(next: TransitionName | null | undefined): number {
  return next ? TRANSITION_FRAMES[next] : 0
}
