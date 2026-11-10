import { cueTime } from './cues'
import { headlineFrom } from './extract'
import { assignBroll } from './broll'
import { groundShots } from './ground'
import {
  DEMO_CUE,
  MAX_HOLD_S,
  imageIndex,
  limitThumbnailReuse,
  newState,
  planRange,
  register,
  reserveCues,
  type PlanState,
} from './planner'
import { enforceVariety } from './variety'
import { finalizeShots, paceShots } from './finalize'
import { repoCardSparse, withPrimarySource } from './sources'
import { holdFor, tableFor } from './table'
import { barProps, quantitiesOf, spokenIn, wordsIn } from './numbers'
import { revealLists, spliceShots } from './lists'
import { quantityValue } from './text-rules'
import { easeTextRuns, fillEmpty, polishKeyPoints, settleEmpty, wordCueKeyPoints } from './polish'
import { completeCode } from './planner'
import type { ReelProps, Scene, ScreenName, Shot, TimedScene, TimedShot } from './types'
import { SCREEN_NAMES, SFX_NAMES } from './types'

export const MIN_CUE_GAP_FRAMES = 18
/** A first cue this far into its scene keeps its word; planned shots fill the lead-in. */
export const LEAD_IN_S = 1.2

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

function validShot(s: Shot, props: ReelProps): boolean {
  if (s.show === 'RepoDemo' && !props.demo) return false
  if (s.show === 'RepoPage' && repoCardSparse(props)) return false
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
export function snapHeadlineEnd(
  end: number,
  shots: readonly Pick<TimedShot, 'from'>[],
  fps: number,
): number {
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
    if (!validShot(raw, props)) {
      warnings.push(`scene ${sceneIndex} shot ${k}: unknown screen or sfx, skipped`)
      continue
    }
    let shotProps = raw.props ?? {}
    if (raw.show === 'CodeBlock') {
      const code = completeCode(shotProps.code)
      if (!code) {
        warnings.push(`scene ${sceneIndex} shot ${k}: code is not a complete line, skipped`)
        continue
      }
      shotProps = { ...shotProps, code }
    }
    const t =
      typeof raw.t === 'number' && raw.t >= t0 && raw.t < t1
        ? raw.t
        : cueTime(raw.at, props.words, { from: t0, to: t1 })
    if (t === null) {
      if (k > 0) {
        warnings.push(
          `scene ${sceneIndex} shot ${k}: cue "${raw.at}" not found in the voice, skipped`,
        )
        continue
      }
    }
    const lead = t === null || t - t0 < LEAD_IN_S ? t0 : t
    const from = lead === t0 ? scene.from : Math.round(lead * fps)
    const prev = cueShots[cueShots.length - 1]
    const minGap = prev ? Math.round((holdFor(prev.show)?.gap ?? 0) * fps) : 0
    if (
      from >= sceneEnd - MIN_CUE_GAP_FRAMES / 2 ||
      (prev && from - prev.from < Math.max(MIN_CUE_GAP_FRAMES, minGap))
    ) {
      warnings.push(
        `scene ${sceneIndex} shot ${k}: cue "${raw.at}" too close to a neighbour, skipped`,
      )
      continue
    }
    cueShots.push({
      from,
      frames: 1,
      show: raw.show,
      props: shotProps,
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
  reserveCues(state, props, cueShots)
  const lead: TimedShot[] =
    cueShots[0]!.from > scene.from
      ? planRange(planCtx, scene, sceneIndex, scene.start, cueShots[0]!.from / fps, state, {
          firstInScene: true,
          lastInScene: false,
        })
      : []
  for (const s of cueShots) {
    register(
      state,
      s.show,
      s.from / fps,
      props.images?.[imageIndex(s.props)]?.kind,
      imageIndex(s.props),
      s.props,
    )
  }
  const out: TimedShot[] = [...lead]
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
      warnings.push(
        `scene ${sceneIndex}: cue shot held over ${MAX_HOLD_S}s, filled with planned shots`,
      )
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

/** Consecutive RepoDemo cuts continue the clip where the previous one stopped (looping if short). */
export function withDemoOffsets(
  shots: TimedShot[],
  seconds: number | undefined,
  fps: number,
): TimedShot[] {
  if (!seconds || seconds <= 0) return shots
  let played = 0
  return shots.map((s) => {
    if (s.show !== 'RepoDemo') return s
    const offset = played % seconds
    played += s.frames / fps
    return { ...s, props: { ...s.props, offset: Math.round(offset * 100) / 100 } }
  })
}

/** Beat sheet cues (or the deterministic planner when absent) -> shots covering every frame. Never throws. */
export function resolveShots(
  input: ReelProps,
  fps: number,
  total: number,
  trace?: (stage: string, shots: readonly TimedShot[]) => void,
): Resolved {
  const props = withPrimarySource(input)
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
  const step = (stage: string, out: TimedShot[]) => {
    trace?.(stage, out)
    return out
  }
  step('fit', shots)
  const listed = step('lists', wordCueKeyPoints(revealLists(shots, props, fps), props, fps))
  const limited = step('thumbs', limitThumbnailReuse(listed, props, fps))
  const tabled = step('tables', matchTables(limited, props, fps))
  const compared = step('compare', compareStats(tabled, props, fps))
  const varied = step('variety', demoOnCue(enforceVariety(compared, props, fps), props, fps))
  const grounded = step('ground', groundShots(varied, props))
  const worded = step(
    'words',
    fillEmpty(easeTextRuns(polishKeyPoints(grounded, props, fps), fps), props, fps),
  )
  const backed = step('broll', settleEmpty(assignBroll(worded, props.broll), props, fps))
  const final = step('final', finalizeShots(backed, props, fps))
  const paced = step('pace', paceShots(final, props, fps))
  return { shots: withDemoOffsets(paced, props.demo?.seconds, fps), warnings }
}

/**
 * A table appears only when a number said over it is a cell of it and the numbers it is compared
 * with are too (see `tableFor`). Otherwise the shot becomes a StatSlam of the number said, or an
 * empty shot for the later passes when nothing is said: a table nobody narrates is never shown.
 */
export function matchTables(shots: TimedShot[], props: ReelProps, fps: number): TimedShot[] {
  return shots.map((shot) => {
    if (shot.show !== 'TableScreen') return shot
    const focused = tableFor(shot.props, shot, props, fps)
    if (focused) return { ...shot, props: focused }
    const scene = props.scenes[shot.sceneIndex]
    const spoken = wordsIn(props.words, shot.from / fps - 0.3, (shot.from + shot.frames) / fps)
    const first = scene && 'text' in scene ? spokenIn(scene.text, spoken)[0] : undefined
    if (!first)
      return {
        ...shot,
        show: 'KeyPoint' as ScreenName,
        props: { text: '', sub: '' },
        origin: 'planned',
      }
    return {
      ...shot,
      show: 'StatSlam' as ScreenName,
      props: { value: first.raw, label: first.label },
      sfx: 'ding' as const,
    }
  })
}

/**
 * A stat said as one side of a comparison ("94.7% average recovery, surpassing MOPD's 80.9%";
 * "falls from 22.9 to 14.9 gigabytes") is shown once, as bars that name both sides (`times` marks
 * when each is said, seconds into the shot). One shot of at most 4 s that ends just after the
 * second number; what comes before it keeps its own shot. Later shots of either number are dropped.
 */
export function compareStats(shots: TimedShot[], props: ReelProps, fps: number): TimedShot[] {
  let out = shots.map((s) => ({ ...s }))
  const done = new Set<number | null>()
  for (let i = 0; i < out.length; i += 1) {
    const shot = out[i]!
    if (shot.show !== 'StatSlam') continue
    const scene = props.scenes[shot.sceneIndex]
    if (!scene || !('text' in scene)) continue
    const v = quantityValue(String(shot.props.value ?? ''))
    if (done.has(v)) continue
    const pair = comparisonFor(scene.text, v)
    if (!pair) continue
    const t1 = spokenAt(props, scene, pair.first)
    const t2 = spokenAt(props, scene, pair.second)
    if (!t1 || !t2 || t2.start <= t1.start) continue
    const prev = out[i - 1]
    const blankBefore =
      prev &&
      prev.sceneIndex === shot.sceneIndex &&
      prev.show === 'KeyPoint' &&
      !prev.props.text &&
      !prev.props.items &&
      !prev.props.quote
    const floor = prev ? (blankBefore ? prev.from : prev.from + 0.6 * fps) / fps : 0
    const end = Math.max((shot.from + shot.frames) / fps, t2.end + 0.5)
    const start = Math.max(
      blankBefore ? floor : Math.max(floor, Math.min(shot.from / fps, t1.start - 0.15)),
      end - MAX_HOLD_S,
    )
    if (end - start < 1.2) continue
    const from = Math.round(start * fps)
    const made: TimedShot[] = [
      {
        ...shot,
        from,
        frames: Math.round(end * fps) - from,
        show: 'BarRace',
        sfx: 'tick',
        props: {
          ...pair.bars,
          times: (pair.saidLast ?? [0, 1])
            .map((k) => [t1, t2][k]!.start - start)
            .map((t) => Math.max(0, Math.round(t * 100) / 100)),
        },
      },
    ]
    done.add(v)
    done.add(quantityValue(pair.second.raw))
    done.add(quantityValue(pair.first.raw))
    out = spliceShots(out, made, fps)
    i = out.indexOf(made[made.length - 1]!)
    for (let k = i + 1; k < out.length && out[k]!.sceneIndex === shot.sceneIndex; k += 1) {
      const s = out[k]!
      if (made.includes(s)) continue
      const vals =
        s.show === 'StatSlam'
          ? [quantityValue(String(s.props.value ?? ''))]
          : s.show === 'BarRace' && Array.isArray(s.props.bars)
            ? (s.props.bars as { value?: unknown }[]).map((b) =>
                quantityValue(String(b.value ?? '')),
              )
            : []
      if (vals.some((x) => done.has(x)))
        out[k] = { ...s, show: 'KeyPoint', props: { text: '', sub: '' }, origin: 'planned' }
    }
  }
  return out
}

type Said = { raw: string; index: number; sentence: string }

/** The other side of a comparison for value `v` in a narration text, as named bars. */
export function comparisonFor(
  text: string,
  v: number | null,
): {
  first: Said
  second: Said
  bars: ReturnType<typeof barProps>
  /** For each bar, which of [first, second] it shows (said order differs from bar order). */
  saidLast?: [number, number]
} | null {
  const all = quantitiesOf(text)
  const q = all.find((x) => quantityValue(x.raw) === v)
  if (!q) return null
  const was = / · was (\S+)/.exec(q.label)?.[1]
  if (was) {
    // "20 minutes instead of 49": the old value is said after the new one; bars stay Before, Now.
    const digits = /\d[\d,]*(?:\.\d+)?/.exec(was)?.[0] ?? ''
    const index = digits ? q.sentence.indexOf(digits, q.index + q.raw.length) : -1
    const head = q.label.split(' · ')[0] ?? ''
    if (index < 0 || !head) return null
    const unit = q.raw.replace(/^[~<>≈]?\s*\d[\d,]*(?:\.\d+)?/, '')
    const before = /\d$/.test(was) && unit ? `${was}${unit}` : was
    return {
      first: q,
      second: { raw: before, index, sentence: q.sentence },
      bars: {
        title: head,
        bars: [
          { label: 'Before', value: before },
          { label: 'Now', value: q.raw },
        ],
      },
      saidLast: [1, 0],
    }
  }
  const from = / · from (\S+)$/.exec(q.label)?.[1]
  if (from) {
    const digits = /\d[\d,]*(?:\.\d+)?/.exec(from)?.[0] ?? ''
    const index = digits ? q.sentence.indexOf(digits) : -1
    const head = q.label.split(' · ')[0] ?? ''
    if (index < 0 || index >= q.index || !head) return null
    return {
      first: { raw: from, index, sentence: q.sentence },
      second: q,
      bars: {
        title: head,
        bars: [
          { label: 'Before', value: from },
          { label: 'Now', value: q.raw },
        ],
      },
    }
  }
  const other = all.find(
    (x) =>
      x !== q &&
      x.sentence === q.sentence &&
      x.unit === q.unit &&
      x.unit !== '' &&
      quantityValue(x.raw) !== v &&
      !x.label.includes(' · from'),
  )
  if (!other) return null
  const [first, second] = q.index < other.index ? [q, other] : [other, q]
  const bars = barProps(first, second)
  return bars.title ? { first, second, bars } : null
}

/** When the digits of a narrated number are spoken inside a scene. */
function spokenAt(
  props: ReelProps,
  scene: { start: number; end: number },
  q: Said,
): { start: number; end: number } | null {
  const digits = /\d[\d,]*(?:\.\d+)?/.exec(q.raw)?.[0] ?? ''
  const w = props.words.find(
    (x) => x.start >= scene.start - 0.01 && x.start < scene.end && x.text.includes(digits),
  )
  return w ? { start: w.start, end: w.end } : null
}

/** The demo cut lands on the word that points at it ("Watch the tour"), not a beat later. */
export function demoOnCue(shots: TimedShot[], props: ReelProps, fps: number): TimedShot[] {
  const out = shots.map((s) => ({ ...s }))
  for (const w of props.words) {
    if (!DEMO_CUE.test(w.text)) continue
    const at = Math.round(w.start * fps)
    const k = out.findIndex((s) => s.show === 'RepoDemo' && s.from > at && s.from - at <= 0.9 * fps)
    const prev = out[k - 1]
    if (k <= 0 || !prev || at - prev.from < 0.6 * fps) continue
    const d = out[k]!.from - at
    if (out[k]!.frames + d > MAX_HOLD_S * fps) continue
    prev.frames -= d
    out[k]!.from = at
    out[k]!.frames += d
  }
  return out
}
