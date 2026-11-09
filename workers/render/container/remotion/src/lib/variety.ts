import {
  CAP_PER_SCREEN,
  NO_REPEAT_WITHIN,
  MAY_REPEAT,
  capFor,
  varietyKey,
  imageIndex,
  newState,
  pickShot,
  recentLook,
  register,
  sfxFor,
  usableImages,
  type PlanState,
} from './planner'
import { MAX_HOLD_S } from './planner'
import { holdFor } from './table'
import type { ReelProps, ScreenName, TimedShot } from './types'

export const IMAGE_SHOWS = new Set<ScreenName>([
  'ImageFull',
  'FigureZoom',
  'YouTubePlayer',
  'ArticleHeadline',
])

function violates(shot: TimedShot, state: PlanState, ahead: readonly TimedShot[] = []): boolean {
  if (
    shot.origin === 'planned' &&
    ahead.some((a) => a.origin === 'cue' && a.show === shot.show && !MAY_REPEAT.has(a.show))
  ) {
    return true
  }
  if ((state.uses[varietyKey(shot.show, shot.props)] ?? 0) >= capFor(shot.show)) return true
  if (
    !MAY_REPEAT.has(shot.show) &&
    recentLook(state, shot.show, shot.props, state.history[state.history.length - 1])
  )
    return true
  if (
    IMAGE_SHOWS.has(shot.show) &&
    (state.imageUses[imageIndex(shot.props)] ?? 0) >= CAP_PER_SCREEN
  ) {
    return true
  }
  return false
}

/**
 * Walks the final timeline and re-picks any shot that would exceed its cap (2 per screen look, 1
 * EndCard, 2 per image) or repeat a screen within 3 shots. When nothing else is available the shot is
 * folded into the previous one (holds stay under their max), and only if that is not possible either
 * does it stay, so a short list of sources never produces a hole.
 */
export function enforceVariety(shots: TimedShot[], props: ReelProps, fps: number): TimedShot[] {
  const state = newState()
  const ctx = { props, fps }
  const hasImages = usableImages(props.images).length > 0
  const out: TimedShot[] = []
  shots.forEach((shot, i) => {
    let cur = shot
    if (i > 0 && violates(shot, state, shots.slice(i + 1, i + NO_REPEAT_WITHIN))) {
      const scene = props.scenes[shot.sceneIndex]
      const start = shot.from / fps
      const chunk = { start, end: (shot.from + shot.frames) / fps }
      const picked = scene
        ? pickShot(ctx, scene, shot.sceneIndex, chunk, false, false, start, state, [shot.show])
        : null
      const next =
        picked && picked.show !== shot.show && !(picked.show === 'EndCard' && i < shots.length - 1)
          ? { ...shot, show: picked.show, props: picked.props, origin: 'planned' as const }
          : null
      if (next && !violates(next, state, shots.slice(i + 1, i + NO_REPEAT_WITHIN))) {
        cur = { ...next, sfx: sfxFor(next.show, i, state.history[state.history.length - 1]) }
      } else {
        const prev = out[out.length - 1]
        const room = (holdFor(prev?.show ?? 'KeyPoint')?.max ?? MAX_HOLD_S) * fps
        if (prev && shot.show !== 'EndCard' && prev.frames + shot.frames <= room) {
          prev.frames += shot.frames
          return
        }
        if (next)
          cur = { ...next, sfx: sfxFor(next.show, i, state.history[state.history.length - 1]) }
      }
    }
    const idx = imageIndex(cur.props)
    register(
      state,
      cur.show,
      cur.from / fps,
      hasImages ? props.images?.[idx]?.kind : undefined,
      idx,
      cur.props,
    )
    out.push({ ...cur })
  })
  return out
}
