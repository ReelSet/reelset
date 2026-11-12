import { toPages } from '@plan/lib/captions'
import { statSaysHeadline } from '@plan/lib/hook'
import { withPrimarySource } from '@plan/lib/sources'
import {
  headlineEnd,
  headlineOf,
  resolveShots,
  snapHeadlineEnd,
  toFrames,
  totalFrames,
} from '@plan/lib/timeline'
import { pickTransitions, type TransitionName } from '@plan/lib/transitions'
import { displayTitle } from '@plan/lib/typeset'
import type {
  BrollClip,
  ItemFacts,
  ReelDemo,
  ReelImage,
  ReelProps,
  ScreenName,
  SfxName,
  Source,
  TimedShot,
  Word,
} from '@plan/lib/types'
import { HEADLINE_PAD, PLAN_FPS } from './engine/kit'

export type { ReelProps, ScreenName, Word, ReelImage, BrollClip, ReelDemo, ItemFacts, Source }

/** What every screen may know about the item. */
export type ReelCtx = {
  title: string
  source: Source
  sourceLabel: string
  domain: string
  facts: ItemFacts
  images: ReelImage[]
  hook: string
  headline?: string
  demo?: ReelDemo
  demoInPlan: boolean
}

/** A planned shot in seconds. `props` are the planner's props for its screen. */
export type Shot = {
  index: number
  show: ScreenName
  props: Record<string, unknown>
  t0: number
  t1: number
  dur: number
  sceneIndex: number
  origin: TimedShot['origin']
  sfx?: SfxName
  /** Px the content zone is pushed down because the headline card sits on top of it. */
  topPad: number
  /** Stock clip behind this shot, if the planner gave it one. */
  clip: BrollClip | null
  /** Seam into this shot: 'left' push, 'up' rise, or a hard 'cut'. */
  enter: 'left' | 'up' | 'cut' | null
  /** Model-written scene drawing this shot instead of the planner screen. */
  screen?: import('./screens/types').Screen
  /** ffmpeg grade for the stock clip (default: the dim backdrop grade). */
  grade?: string
}

export type Reel = {
  props: ReelProps
  ctx: ReelCtx
  duration: number
  shots: Shot[]
  /** Narration scenes in seconds (header progress segments). */
  scenes: { t0: number; t1: number; kind: string }[]
  headline: { text: string; t1: number } | null
  pages: Word[][]
  warnings: string[]
  planFrames: number
}

const seamOf = (name: TransitionName | null | undefined): Shot['enter'] =>
  !name ? null : name === 'cut' || name === 'punch' ? 'cut' : name === 'rise' ? 'up' : 'left'

export function buildReel(input: ReelProps): Reel {
  const props = withPrimarySource(input)
  const total = totalFrames(props.durationSeconds, PLAN_FPS)
  const resolved = input.plan
    ? { shots: input.plan, warnings: [] }
    : resolveShots(props, PLAN_FPS, total)
  const planned = resolved.shots
  const headline = headlineOf(props)
  const hookIsHeadline = planned[0]?.props.hook === true || statSaysHeadline(planned[0], headline)
  const headlineT = hookIsHeadline ? 0 : snapHeadlineEnd(headlineEnd(props), planned, PLAN_FPS)
  const seams = pickTransitions(planned.map((s) => s.show))
  const sec = (f: number) => f / PLAN_FPS
  const shots: Shot[] = planned.map((s, i) => {
    const t0 = sec(s.from)
    const t1 = i + 1 < planned.length ? sec(planned[i + 1]!.from) : props.durationSeconds
    const bg = s.props.bg
    return {
      index: i,
      show: s.show,
      props: s.props,
      t0,
      t1,
      dur: t1 - t0,
      sceneIndex: s.sceneIndex,
      origin: s.origin,
      sfx: s.sfx,
      topPad: headlineT > 0 && t0 < headlineT - 1e-6 ? HEADLINE_PAD : 0,
      clip: typeof bg === 'number' ? (props.broll?.[bg] ?? null) : null,
      enter: seamOf(seams[i]),
    }
  })
  const ctx: ReelCtx = {
    title: displayTitle(props.title),
    source: props.source,
    sourceLabel: props.sourceLabel,
    domain: props.domain,
    facts: props.facts ?? {},
    images: props.images ?? [],
    demo: props.demo,
    demoInPlan: planned.some((s) => s.show === 'RepoDemo'),
    hook: props.scenes[0]?.kind === 'hook' ? props.scenes[0].text : props.title,
    headline: props.headline,
  }
  const scenes = toFrames(props.scenes, PLAN_FPS, total).map((s) => ({
    t0: sec(s.from),
    t1: sec(s.from + s.frames),
    kind: s.kind,
  }))
  return {
    props,
    ctx,
    duration: props.durationSeconds,
    shots,
    scenes,
    headline: headlineT > 0 ? { text: headline, t1: headlineT } : null,
    pages: toPages(props.words, 4, 24),
    warnings: resolved.warnings,
    planFrames: total,
  }
}

export function shotAt(reel: Reel, t: number): Shot {
  const { shots } = reel
  let lo = 0
  let hi = shots.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (shots[mid]!.t0 <= t) lo = mid
    else hi = mid - 1
  }
  return shots[lo]!
}

/** The timeline.json the container reads for sfx placement and stock-clip credits. */
export function timelineOf(reel: Reel) {
  const r3 = (n: number) => Math.round(n * 1000) / 1000
  return {
    fps: PLAN_FPS,
    durationInFrames: reel.planFrames,
    usedBroll: [...new Set(reel.shots.map((s) => s.props.bg).filter((n) => Number.isInteger(n)))],
    usedDemo: reel.shots.some((s) => s.show === 'RepoDemo'),
    shots: reel.shots.map((s) => ({
      t: r3(s.t0),
      seconds: r3(s.dur),
      show: s.show,
      sfx: s.sfx,
      origin: s.origin,
      scene: s.sceneIndex,
    })),
  }
}
