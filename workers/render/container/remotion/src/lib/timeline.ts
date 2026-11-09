import { cueTime } from './cues'
import { headlineFrom } from './extract'
import { MAX_HOLD_S, limitThumbnailReuse, newState, planRange, type PlanState } from './planner'
import { holdFor } from './table'
import type { ReelProps, Scene, ScreenName, Shot, TimedScene, TimedShot } from './types'
import { SCREEN_NAMES, SFX_NAMES } from './types'

export const MIN_CUE_GAP_FRAMES = 18

export function totalFrames(durationSeconds: number, fps: number): number {
  return Math.max(1, Math.ceil(durationSeconds * fps))
}

export function toFrames(scenes: readonly Scene[], fps: number, total: number): TimedScene[] {
  const starts = scenes.map((s, i) => (i === 0 ? 0 : Math.round(s.start * fps)))
  return scenes.map((scene, i) => {
    const from = Math.min(starts[i] ?? 0, total - 1)
    const to = i + 1 < scenes.length ? Math.round((scenes[i + 1]?.start ?? 0) * fps) : total
    return { ...scene, from, frames: Math.max(1, to - from) }
  })
}

export type Resolved = { shots: TimedShot[]; warnings: string[] }

function validShot(s: Shot): boolean {
  return (
    typeof s.at === 'string' &&
    (SCREEN_NAMES as readonly string[]).includes(s.show) &&
    (s.sfx === undefined || (SFX_NAMES as readonly string[]).includes(s.sfx))
  )
}

/** Hook text, first clause, uppercase-ready, at most 7 words. */
export function headlineOf(props: Pick<ReelProps, 'headline' | 'scenes' | 'title'>): string {
  const given = props.headline?.trim()
  if (given) return given.split(/\s+/).slice(0, 7).join(' ')
  const hook = props.scenes.find((s) => s.kind === 'hook')
  return headlineFrom(hook && 'text' in hook ? hook.text : props.title)
}

/** Seconds the headline card stays: through the first sentence, clamped to 2-3 s. */
export function headlineEnd(props: Pick<ReelProps, 'scenes' | 'words'>): number {
  const hook = props.scenes[0]
  const hookEnd = hook?.end ?? 3
  const firstEnd = props.words.find((w) => /[.?!]$/.test(w.text))?.end ?? 3
  return Math.min(3, Math.max(2, Math.min(firstEnd, hookEnd)))
}

/** Moves the headline's end to the nearest shot boundary so no shot straddles its exit. */
export function snapHeadlineEnd(end: number, shots: readonly Pick<TimedShot, 'from'>[], fps: number): number {
  let best = end
  let gap = Infinity
  for (const s of shots) {
    const t = s.from / fps
    if (t < 1.7 || t > 3.4) continue
    const d = Math.abs(t - end)
    if (d < gap) {
      gap = d
      best = t
    }
  }
  return best
}

function fitSceneShots(
  props: ReelProps,
  scene: TimedScene,
  sceneIndex: number,
  fps: number,
  state: PlanState,
  warnings: string[],
): TimedShot[] {
  const sceneEnd = scene.from + scene.frames
  const planCtx = { props, fps }
  const cueShots: TimedShot[] = []
  const t0 = scene.start
  const t1 = scene.end
  for (const [k, raw] of (scene.shots ?? []).entries()) {
    if (!validShot(raw)) {
      warnings.push(`scene ${sceneIndex} shot ${k}: unknown screen or sfx, skipped`)
      continue
    }
    const t =
      k === 0
        ? t0
        : typeof raw.t === 'number' && raw.t >= t0 && raw.t < t1
          ? raw.t
          : cueTime(raw.at, props.words, { from: t0, to: t1 })
    if (t === null) {
      warnings.push(`scene ${sceneIndex} shot ${k}: cue "${raw.at}" not found in the voice, skipped`)
      continue
    }
    const from = k === 0 ? scene.from : Math.round(t * fps)
    const prev = cueShots[cueShots.length - 1]
    const minGap = prev ? Math.round((holdFor(prev.show)?.gap ?? 0) * fps) : 0
    if (
      from >= sceneEnd - MIN_CUE_GAP_FRAMES / 2 ||
      (prev && from - prev.from < Math.max(MIN_CUE_GAP_FRAMES, minGap))
    ) {
      warnings.push(`scene ${sceneIndex} shot ${k}: cue "${raw.at}" too close to a neighbour, skipped`)
      continue
    }
    cueShots.push({
      from,
      frames: 1,
      show: raw.show,
      props: raw.props ?? {},
      sfx: raw.sfx,
      sceneIndex,
      origin: 'cue',
    })
  }
  if (cueShots.length === 0) {
    const planned = planRange(planCtx, scene, sceneIndex, scene.start, scene.end, state, {
      firstInScene: true,
      lastInScene: sceneIndex === props.scenes.length - 1,
    })
    return finish(planned, scene.from, sceneEnd)
  }
  cueShots[0]!.from = scene.from
  for (const s of cueShots) state.history.push(s.show)
  const out: TimedShot[] = []
  cueShots.forEach((s, i) => {
    const hold = holdFor(s.show)
    const maxHold = Math.round((hold?.max ?? MAX_HOLD_S) * fps)
    const end = cueShots[i + 1]?.from ?? sceneEnd
    out.push({ ...s, frames: Math.max(1, end - s.from) })
    if (end - s.from > maxHold) {
      const keep = Math.round((hold?.keep ?? 2.4) * fps)
      const cut = out[out.length - 1]!
      cut.frames = keep
      out.push(
        ...planRange(planCtx, scene, sceneIndex, (s.from + keep) / fps, end / fps, state, {
          firstInScene: false,
          lastInScene: false,
        }),
      )
      warnings.push(`scene ${sceneIndex}: cue shot held over ${MAX_HOLD_S}s, filled with planned shots`)
    }
  })
  return finish(out, scene.from, sceneEnd)
}

function finish(shots: TimedShot[], from: number, end: number): TimedShot[] {
  const sorted = [...shots].sort((a, b) => a.from - b.from)
  return sorted.map((s, i) => {
    const start = i === 0 ? from : s.from
    const to = sorted[i + 1]?.from ?? end
    return { ...s, from: start, frames: Math.max(1, to - start) }
  })
}

/** Beat sheet cues (or the deterministic planner when absent) -> shots covering every frame. Never throws. */
export function resolveShots(props: ReelProps, fps: number, total: number): Resolved {
  const warnings: string[] = []
  const scenes = toFrames(props.scenes, fps, total)
  const state = newState()
  const shots: TimedShot[] = []
  scenes.forEach((scene, i) => {
    try {
      shots.push(...fitSceneShots(props, scene, i, fps, state, warnings))
    } catch (err) {
      warnings.push(`scene ${i}: ${(err as Error).message}, using one fallback shot`)
      shots.push({
        from: scene.from,
        frames: scene.frames,
        show: 'KeyPoint' as ScreenName,
        props: { text: props.title, sub: '' },
        sceneIndex: i,
        origin: 'planned',
      })
    }
  })
  return { shots: limitThumbnailReuse(shots, props, fps), warnings }
}
