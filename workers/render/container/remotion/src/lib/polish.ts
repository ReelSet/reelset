import { isCallToAction, termsCard } from './finalize'
import { findQuantities, quantityValue } from './text-rules'
import { FOLD_MAX_S, MAX_HOLD_S, givenKeyPoint, keyPointFor } from './planner'
import { spokenIn, wordsIn } from './numbers'
import { tableFor } from './table'
import type { ReelProps, TimedShot } from './types'

const str = (v: unknown) => (typeof v === 'string' ? v : '')

/** Items of the reel's spoken lists: a key point repeating them would show the list twice. */
const listWordsOf = (shots: readonly TimedShot[]): string[] =>
  shots.flatMap((s) =>
    Array.isArray(s.props.items)
      ? (s.props.items as unknown[]).map((i) => str(i).toLowerCase())
      : [],
  )

type Picker = { used: Set<string>; others: string[]; listWords: string[] }

/** Key point text for a shot (the model's claim, else a claim of what is said), or ''. */
function wordShot(shot: TimedShot, props: ReelProps, fps: number, pick: Picker): string {
  const scene = props.scenes[shot.sceneIndex]
  const sceneText = scene && 'text' in scene ? scene.text : ''
  const spoken = wordsIn(props.words, shot.from / fps, (shot.from + shot.frames) / fps)
  const given = str(shot.props.text) || undefined
  const avoid = new Set([...pick.used, ...pick.others])
  const options = keyPointFor(
    props,
    sceneText,
    spoken,
    { keyTexts: avoid },
    given,
    3,
    str(shot.props.sub),
  )
  return options.find((t) => !repeatsList(t, pick.listWords) && !isCallToAction(t)) ?? ''
}

const repeatsList = (text: string, items: readonly string[]) =>
  items.some((w) => text.toLowerCase().includes(w))

/** A key point the model filled with a number ("Muon optimizer 12x faster") is that number's stat. */
function statFor(
  shot: TimedShot,
  props: ReelProps,
  fps: number,
  shown: Set<number>,
): TimedShot | null {
  const given = str(shot.props.text)
  if (!given || findQuantities(given).length === 0) return null
  const scene = props.scenes[shot.sceneIndex]
  const sceneText = scene && 'text' in scene ? scene.text : ''
  const spoken = wordsIn(props.words, shot.from / fps, (shot.from + shot.frames) / fps)
  const stat = spokenIn(sceneText, spoken)[0]
  const v = stat ? quantityValue(stat.raw) : null
  if (!stat?.label || v === null || shown.has(v)) return null
  shown.add(v)
  return { ...shot, show: 'StatSlam', props: { value: stat.raw, label: stat.label } }
}

/**
 * Cue key points are worded before the variety pass, so a cue keeps its moment only with a claim
 * to show: the model's text when it is one, else a claim of the sentence being said. A cue left
 * with nothing becomes a planned shot that the variety pass may re-pick.
 */
export function wordCueKeyPoints(shots: TimedShot[], props: ReelProps, fps: number): TimedShot[] {
  const shown = new Set<number>()
  const pick: Picker = { used: new Set(), others: [], listWords: listWordsOf(shots) }
  return shots.map((shot) => {
    if (shot.show !== 'KeyPoint' || shot.origin !== 'cue' || shot.props.quote) return shot
    if (Array.isArray(shot.props.items)) return shot
    const stat = statFor(shot, props, fps, shown)
    if (stat) return stat
    const given = givenKeyPoint(props, shot.props.text, shot.props.sub)
    const own =
      given && !repeatsList(given, pick.listWords) && !isCallToAction(given) ? given : null
    const text = own && !pick.used.has(own.toLowerCase()) ? own : wordShot(shot, props, fps, pick)
    if (!text) {
      // A cue that names things ("Linear parameter combination") lights them as they are said.
      const terms = termsCard(shot, props, fps, 1)
      if (terms) return { ...terms, origin: 'cue' }
      return { ...shot, origin: 'planned', props: { text: '', sub: '' } }
    }
    pick.used.add(text.toLowerCase())
    const sub = own === text ? str(shot.props.sub) : ''
    return { ...shot, props: { ...shot.props, text, sub } }
  })
}

/**
 * Last word on every key point: its text must be a claim (the model's text if valid, else a short
 * claim of what is being said) and not one already shown. With nothing honest to say the shot is
 * left empty (`text: ''`) for `fillEmpty`.
 */
export function polishKeyPoints(shots: TimedShot[], props: ReelProps, fps: number): TimedShot[] {
  const reserved = new Map<TimedShot, string>()
  for (const shot of shots) {
    if (shot.show !== 'KeyPoint' || shot.origin !== 'cue' || shot.props.quote) continue
    const t = givenKeyPoint(props, shot.props.text, shot.props.sub)
    if (t) reserved.set(shot, t)
  }
  const shown = new Set(
    shots.flatMap((s) => {
      const v = s.show === 'StatSlam' ? quantityValue(str(s.props.value)) : null
      return v === null ? [] : [v]
    }),
  )
  const pick: Picker = { used: new Set(), others: [], listWords: listWordsOf(shots) }
  return shots.map((shot) => {
    if (shot.show !== 'KeyPoint' || shot.props.quote || Array.isArray(shot.props.items)) return shot
    const stat = statFor(shot, props, fps, shown)
    if (stat) return stat
    const own = reserved.get(shot)
    pick.others = [...reserved].filter(([s]) => s !== shot).map(([, t]) => t.toLowerCase())
    const text = own && !pick.used.has(own.toLowerCase()) ? own : wordShot(shot, props, fps, pick)
    if (!text) return { ...shot, props: { ...shot.props, text: '', sub: '' } }
    pick.used.add(text.toLowerCase())
    return { ...shot, props: { ...shot.props, text } }
  })
}

/** A caption-only shot (with or without stock footage): anything real is better. */
const isCaptionOnly = (s: TimedShot) =>
  s.show === 'KeyPoint' && !s.props.quote && !Array.isArray(s.props.items) && !str(s.props.text)
const isBlank = (s: TimedShot) => isCaptionOnly(s) && typeof s.props.bg !== 'number'

/** Paper tables the script referenced (renderer props), for an empty slot where a cell is said. */
const tablesOf = (props: ReelProps): Record<string, unknown>[] =>
  props.scenes.flatMap((sc) =>
    (sc.shots ?? []).filter((s) => s.show === 'TableScreen' && s.props).map((s) => s.props!),
  )

/**
 * Empty shots first take a real asset nobody has seen in that form yet (an unused table, a second
 * crop of a figure, an unused source-card look, the demo when the narration points at it), then
 * fold into the shot before (holds <= 3.5 s). What is left is stock footage or absorbed later.
 */
export function fillEmpty(shots: TimedShot[], props: ReelProps, fps: number): TimedShot[] {
  const out: TimedShot[] = []
  const has = (show: string, test: (s: TimedShot) => boolean = () => true) =>
    out.some((s) => s.show === show && test(s)) || shots.some((s) => s.show === show && test(s))
  const tables = tablesOf(props)
  const tableScene = props.scenes.findIndex((sc) =>
    (sc.shots ?? []).some((s) => s.show === 'TableScreen'),
  )
  const runs: TimedShot[] = []
  for (const shot of shots) {
    const last = runs[runs.length - 1]
    if (
      last &&
      isCaptionOnly(last) &&
      isCaptionOnly(shot) &&
      shot.from === last.from + last.frames
    ) {
      last.frames += shot.frames
      continue
    }
    runs.push({ ...shot })
  }
  const blanks = runs.filter(isCaptionOnly)
  const tableSlot =
    blanks.find((b) => b.sceneIndex === tableScene && b.frames >= 2 * fps) ??
    blanks.find((b) => b.sceneIndex >= tableScene && b.frames >= 2 * fps)
  const figures = (props.images ?? []).flatMap((img, i) => (img.kind === 'figure' ? [i] : []))
  const figureUses = (i: number) =>
    [...out, ...shots].filter(
      (s) => (s.show === 'FigureZoom' || s.props.variant === 'figure') && s.props.image === i,
    ).length
  runs.forEach((shot, i) => {
    const prev = out[out.length - 1]
    if (!isCaptionOnly(shot)) {
      out.push(shot)
      return
    }
    const asset = (): TimedShot | null => {
      const table = tables[0]
      const focused =
        table && shot === tableSlot && !has('TableScreen') && prev?.show !== 'TableScreen'
          ? tableFor(table, shot, props, fps)
          : null
      if (focused) return { ...shot, show: 'TableScreen', props: focused }
      const fig = figures.find((i) => figureUses(i) < 1)
      const nextShow = shots[shots.indexOf(shot) + 1]?.show
      if (fig !== undefined && prev?.show !== 'FigureZoom' && nextShow !== 'FigureZoom') {
        const variant = 2 + figureUses(fig)
        return { ...shot, show: 'FigureZoom', props: { image: fig, variant } }
      }
      return null
    }
    const made = asset()
    if (made) {
      out.push({ ...made, origin: 'planned' })
      return
    }
    const next = runs[i + 1]
    const max = Math.round(MAX_HOLD_S * fps)
    const nextOk =
      next &&
      next.origin !== 'cue' &&
      next.sceneIndex === shot.sceneIndex &&
      (next.show === 'EndCard' ||
        next.show === 'StatSlam' ||
        Array.isArray(next.props.times) ||
        (next.show === 'KeyPoint' && str(next.props.text)))
    const prevOk = prev && prev.show !== 'EndCard'
    const canNext = nextOk ? Math.max(0, max - next.frames) : 0
    const canPrev = prevOk ? Math.max(0, max - prev.frames) : 0
    const keep = Math.round(1.2 * fps)
    if (canNext + canPrev > 0) {
      let toNext = Math.min(canNext, shot.frames)
      let toPrev = Math.min(canPrev, shot.frames - toNext)
      const short = shot.frames - toNext - toPrev
      if (short > 0 && short < keep) {
        const back = keep - short
        const fromPrev = Math.min(toPrev, back)
        toPrev -= fromPrev
        toNext -= Math.min(toNext, back - fromPrev)
      }
      if (next && toNext > 0) {
        next.from -= toNext
        next.frames += toNext
        if (Array.isArray(next.props.times)) {
          const d = toNext / fps
          next.props = {
            ...next.props,
            times: (next.props.times as number[]).map((t) => Math.round((t + d) * 100) / 100),
          }
        }
      }
      if (prev && toPrev > 0) prev.frames += toPrev
      const left = shot.frames - toNext - toPrev
      const n = Math.ceil(left / max)
      for (let k = 0; k < n; k += 1) {
        const a = Math.round((left * k) / n)
        const b = Math.round((left * (k + 1)) / n)
        out.push({ ...shot, from: shot.from + toPrev + a, frames: b - a })
      }
      return
    }
    if (prev && isCaptionOnly(prev) && prev.frames + shot.frames <= max) {
      prev.frames += shot.frames
      return
    }
    out.push(shot)
  })
  return out
}

/**
 * Caption-only shots that got no stock clip are absorbed by their neighbours (the previous shot
 * holds longer, the next one starts earlier, each at most 4 s). Only when neither has room does the
 * shot get a claim from the title (never a bare label); with none it stays caption-only.
 */
export function settleEmpty(shots: TimedShot[], props: ReelProps, fps: number): TimedShot[] {
  const max = MAX_HOLD_S * fps
  const isEmpty = isBlank
  const out: TimedShot[] = []
  const list = shots.map((s) => ({ ...s }))
  list.forEach((shot, i) => {
    if (!isEmpty(shot)) {
      out.push(shot)
      return
    }
    const prev = out[out.length - 1]
    const next = list[i + 1]
    const canPrev = prev && prev.show !== 'EndCard' ? Math.max(0, max - prev.frames) : 0
    const canNext =
      next && !isEmpty(next) && next.origin !== 'cue' ? Math.max(0, max - next.frames) : 0
    if (canPrev + canNext >= shot.frames) {
      const toPrev = Math.min(canPrev, shot.frames)
      if (prev) prev.frames += toPrev
      if (next && shot.frames > toPrev) {
        next.from -= shot.frames - toPrev
        next.frames += shot.frames - toPrev
      }
      return
    }
    // The terms being said, never the title again (the hook and end card already show it).
    const terms = termsCard(shot, props, fps, 1)
    out.push(terms ?? shot)
  })
  return out
}

/** Average shot length the QA gate allows is 2.5 s; merging stops well before that. */
const MAX_AVG_S = 2.35

/**
 * Three or more key points in a row read like a slideshow. A planned key point inside such a run
 * is merged into the key point before it (hold <= 3.5 s) while the reel keeps its cutting pace.
 */
export function easeTextRuns(shots: TimedShot[], fps: number): TimedShot[] {
  const total = shots.reduce((n, s) => n + s.frames, 0) / fps
  const minShots = Math.ceil(total / MAX_AVG_S)
  const out: TimedShot[] = []
  let count = shots.length
  const isText = (s: TimedShot | undefined) =>
    s?.show === 'KeyPoint' && !s.props.quote && !Array.isArray(s.props.items)
  shots.forEach((shot, i) => {
    const prev = out[out.length - 1]
    const run =
      isText(prev) && isText(shot) && (isText(out[out.length - 2]) || isText(shots[i + 1]))
    if (
      run &&
      prev &&
      shot.origin === 'planned' &&
      count > minShots &&
      prev.frames + shot.frames <= FOLD_MAX_S * fps
    ) {
      prev.frames += shot.frames
      count -= 1
      return
    }
    out.push(shot)
  })
  return out
}
