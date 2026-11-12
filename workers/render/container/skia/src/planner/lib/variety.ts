import {
  imageCap,
  FOLD_MAX_S,
  NO_REPEAT_WITHIN,
  capFor,
  identityOf,
  varietyKey,
  imageIndex,
  newState,
  pickShot,
  recentLook,
  register,
  reserveCues,
  sfxFor,
  usableImages,
  givenKeyPoint,
  type PlanState,
} from './planner'
import { holdFor } from './table'
import { SOURCE_CAP, SOURCE_SCREENS, nextVariant, variantOf } from './sources'
import type { ReelProps, ScreenName, TimedShot } from './types'

export const IMAGE_SHOWS = new Set<ScreenName>([
  'ImageFull',
  'FigureZoom',
  'YouTubePlayer',
  'ArticleHeadline',
])

export function violates(
  shot: TimedShot,
  state: PlanState,
  props: ReelProps,
  ahead: readonly TimedShot[] = [],
  cueStatsLeft = 0,
): boolean {
  if (
    shot.origin === 'planned' &&
    shot.show === 'StatSlam' &&
    (state.uses[varietyKey(shot.show, shot.props)] ?? 0) + cueStatsLeft >= capFor(shot.show)
  ) {
    return true
  }
  if (shot.origin === 'planned' && ahead.some((a) => a.origin === 'cue' && a.show === shot.show)) {
    return true
  }
  if (SOURCE_SCREENS.has(shot.show)) {
    const used = state.sourceUsed[shot.show] ?? []
    if (used.length >= SOURCE_CAP || used.includes(variantOf(shot.props) ?? 'title')) return true
  }
  if ((state.uses[varietyKey(shot.show, shot.props)] ?? 0) >= capFor(shot.show)) return true
  const id = identityOf(shot.show, shot.props)
  if (state.identities.includes(id)) return true
  if (shot.origin === 'planned' && state.reserved.has(id)) return true
  if (recentLook(state, shot.show, shot.props, state.history[state.history.length - 1])) return true
  if (
    IMAGE_SHOWS.has(shot.show) &&
    (state.imageUses[imageIndex(shot.props)] ?? 0) >=
      imageCap(props.images?.[imageIndex(shot.props)])
  ) {
    return true
  }
  return false
}

/** A cue key point with a fresh claim of its own is the model's beat: layout caps never drop it. */
function claimCue(shot: TimedShot, props: ReelProps, state: PlanState): boolean {
  if (shot.show !== 'KeyPoint' || shot.props.quote) return false
  const t = givenKeyPoint(props, shot.props.text, shot.props.sub)
  return Boolean(t) && !state.keyTexts.has(t!.toLowerCase())
}

/** A source card without a look gets the next free one (a quote/comment prop asks for 'comment'). */
function withVariant(shot: TimedShot, props: ReelProps, state: PlanState): TimedShot {
  if (!SOURCE_SCREENS.has(shot.show) || variantOf(shot.props)) return shot
  const prefer = shot.props.quote ? 'comment' : undefined
  const v = nextVariant(shot.show, props, state.sourceUsed[shot.show] ?? [], prefer)
  if (!v) return shot
  const extra =
    v === 'figure' ? { image: (props.images ?? []).findIndex((i) => i.kind === 'figure') } : {}
  return { ...shot, props: { ...shot.props, variant: v, ...extra } }
}

/**
 * Walks the final timeline and re-picks any shot that would exceed its cap (2 per screen look, 1
 * per source-card look, 3 per source card, 1 EndCard, 2 per image), show something already shown
 * (same text, value, code or card), or repeat a screen within 3 shots. When nothing else is
 * available the shot is folded into the previous one (holds stay at or under 3.5 s), and only if
 * that is not possible either does it stay, never as an identical copy of the shot before it.
 */
export function enforceVariety(shots: TimedShot[], props: ReelProps, fps: number): TimedShot[] {
  const state = newState()
  reserveCues(state, props, shots)
  const ctx = { props, fps }
  const hasImages = usableImages(props.images, false, props).length > 0
  const out: TimedShot[] = []
  shots.forEach((raw, i) => {
    const shot = withVariant(raw, props, state)
    let cur = shot
    const fixed =
      Array.isArray(shot.props.items) ||
      Array.isArray(shot.props.times) ||
      (shot.origin === 'cue' && claimCue(shot, props, state))
    const cueStatsLeft = shots
      .slice(i + 1)
      .filter((s) => s.origin === 'cue' && s.show === 'StatSlam').length
    if (
      i > 0 &&
      !fixed &&
      violates(shot, state, props, shots.slice(i + 1, i + NO_REPEAT_WITHIN), cueStatsLeft)
    ) {
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
      if (
        next &&
        !violates(next, state, props, shots.slice(i + 1, i + NO_REPEAT_WITHIN), cueStatsLeft)
      ) {
        cur = { ...next, sfx: sfxFor(next.show, i, state.history[state.history.length - 1]) }
      } else {
        const prev = out[out.length - 1]
        const room = Math.min(holdFor(prev?.show ?? 'KeyPoint')?.max ?? FOLD_MAX_S, FOLD_MAX_S)
        if (prev && shot.show !== 'EndCard' && prev.frames + shot.frames <= room * fps) {
          prev.frames += shot.frames
          return
        }
        const seen = (s: TimedShot) => state.identities.includes(identityOf(s.show, s.props))
        if (next && !seen(next))
          cur = { ...next, sfx: sfxFor(next.show, i, state.history[state.history.length - 1]) }
        else if (seen(cur) && shot.show !== 'EndCard') {
          cur = { ...cur, show: 'KeyPoint', props: { text: '', sub: '' }, origin: 'planned' }
        }
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
