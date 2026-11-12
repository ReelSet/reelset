import { MAX_HOLD_S, identityOf, imageIndex, newState, pickShot, register, sfxFor } from './planner'
import { violates } from './variety'
import { wordsIn } from './numbers'
import { showable } from './caption-echo'
import { DEMO_MAX_S, DEMO_MIN_S } from './demo'
import { sameIdea } from './ideas'
import { findQuantities, quantityValue } from './text-rules'
import type { ReelProps, ScreenName, TimedShot } from './types'

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const norm = (v: unknown) => str(v).toLowerCase().replace(/\s+/g, ' ').trim()

/** A caption-only shot runs at most this long, footage or not. */
export const CAPTION_ONLY_MAX_S = 2.9
/** Neighbouring footage-only shots (different clips) together run at most this long. */
export const BLANK_RUN_MAX_S = 5
/** Shortest piece a held shot is cut into. */
export const MIN_PIECE_S = 1.3
/** The reel's first shot runs at most this long. */
export const HOOK_FIRST_MAX_S = 2.4
/** Average shot length the pace pass aims for (the QA gate is 2.5 s). */
export const PACE_S = 2.4

export const isCaptionOnly = (s: TimedShot): boolean =>
  s.show === 'KeyPoint' && !s.props.quote && !Array.isArray(s.props.items) && !str(s.props.text)

/**
 * What the viewer sees as "the same screen": same card, text, value or list, ignoring timing and
 * footage. Two neighbouring shots with one look read as one hold (or a stutter).
 */
export function lookKey(s: Pick<TimedShot, 'show' | 'props'>): string {
  const p = s.props
  if (s.show === 'KeyPoint') {
    if (Array.isArray(p.items)) return `KeyPoint/list/${(p.items as unknown[]).join('|')}`
    if (p.quote) return `KeyPoint/q/${norm(p.quote)}`
    if (!str(p.text)) return `KeyPoint/blank/${String(p.bg ?? '')}/${String(p.ambient ?? '')}`
    return `KeyPoint/${norm(p.text)}`
  }
  if (s.show === 'StatSlam') return `StatSlam/${norm(p.value)}`
  if (s.show === 'BarRace') return `BarRace/${JSON.stringify(p.bars ?? [])}`
  if (s.show === 'RepoDemo') return `RepoDemo/${String(p.part ?? '')}`
  return identityOf(s.show, { ...p, bg: undefined, bgAt: undefined, offset: undefined })
}

/** The words a viewer reads on a shot (text, quote, list, stat label, bar names). */
export function visibleText(s: Pick<TimedShot, 'show' | 'props'>): string {
  const p = s.props
  if (Array.isArray(p.items)) return (p.items as unknown[]).map(str).join(' ')
  const parts = [str(p.text), str(p.quote), str(p.label), str(p.title)]
  if (Array.isArray(p.bars))
    parts.push((p.bars as { label?: unknown }[]).map((b) => str(b.label)).join(' '))
  return parts.filter(Boolean).join(' ')
}

const DATA = new Set<ScreenName>(['StatSlam', 'BarRace', 'TableScreen'])

/** Numbers a shot puts on screen big: a stat's value, every bar's value. */
export function shownValues(s: Pick<TimedShot, 'show' | 'props'>): number[] {
  const raw =
    s.show === 'StatSlam'
      ? [s.props.value]
      : s.show === 'BarRace' && Array.isArray(s.props.bars)
        ? (s.props.bars as { value?: unknown }[]).map((b) => b.value)
        : []
  return raw.map((v) => quantityValue(str(v))).filter((v): v is number => v !== null)
}

/**
 * Adjacent shots that repeat one idea: the same words in other words, or the same number slammed
 * twice. A stat followed by the bars that compare it with something else is a new idea.
 */
export function echoes(a: TimedShot, b: TimedShot): boolean {
  if (DATA.has(a.show) && DATA.has(b.show)) {
    if (a.show !== 'StatSlam' || b.show !== 'StatSlam') return false
    const va = shownValues(a)
    return shownValues(b).some((v) => va.includes(v))
  }
  const ta = visibleText(a)
  const tb = visibleText(b)
  if (!ta || !tb) return false
  const big = [...shownValues(a), ...shownValues(b)]
  const said = [a, b]
    .filter((x) => !DATA.has(x.show))
    .flatMap((x) => findQuantities(visibleText(x)).map((q) => q.value))
  if (said.some((v) => big.includes(v))) return true
  return sameIdea(ta, tb)
}

const CTA =
  /^(?:check (?:it )?out|try|follow|visit|star|subscribe|watch|take a look|head (?:to|over)|go to|learn more|read more|find (?:it|out more)|get started|add your|see (?:it|more|the))\b/i

/** "Check out owner/repo on GitHub": the end card's job, never a key point of its own. */
export const isCallToAction = (text: string): boolean => CTA.test(text.trim())

/** Real, specific material ranks above a key point worded from the narration. */
const weight = (s: TimedShot): number =>
  s.show === 'KeyPoint' ? (s.props.quote || Array.isArray(s.props.items) ? 2 : 1) : 3

/**
 * Another shot for `shots[i]` that is new to the reel (caps, identities, variety rules), not the
 * look or idea of either neighbour, and not a long caption-only hold. Null when nothing fits.
 */
export function repick(
  shots: readonly TimedShot[],
  i: number,
  props: ReelProps,
  fps: number,
  avoid: readonly ScreenName[] = [],
): TimedShot | null {
  const shot = shots[i]
  const scene = shot ? props.scenes[shot.sceneIndex] : undefined
  if (!shot || !scene || shot.frames > MAX_HOLD_S * fps) return null
  const state = newState()
  const add = (s: TimedShot) =>
    register(
      state,
      s.show,
      s.from / fps,
      props.images?.[imageIndex(s.props)]?.kind,
      imageIndex(s.props),
      s.props,
    )
  shots.slice(i + 1).forEach(add)
  shots.slice(0, i).forEach(add)
  const start = shot.from / fps
  const chunk = { start, end: (shot.from + shot.frames) / fps }
  const picked = pickShot(
    { props, fps },
    scene,
    shot.sceneIndex,
    chunk,
    false,
    false,
    start,
    state,
    isCaptionOnly(shot) ? [...avoid] : [shot.show, ...avoid],
  )
  const made: TimedShot = {
    ...shot,
    show: picked.show,
    props: picked.props,
    origin: 'planned',
    sfx: sfxFor(picked.show, i, shots[i - 1]?.show),
  }
  const fits = (c: TimedShot) => fitsAt(shots, i, c)
  if (made.show !== 'EndCard' && !avoid.includes(made.show) && lookKey(made) !== lookKey(shot)) {
    const cta = made.show === 'KeyPoint' && isCallToAction(str(made.props.text))
    const longBlank =
      isCaptionOnly(made) &&
      (typeof made.props.bg !== 'number' || shot.frames > CAPTION_ONLY_MAX_S * fps)
    const said = wordsIn(props.words, start - 0.3, chunk.end)
    const echo =
      made.show === 'KeyPoint' &&
      str(made.props.text) !== '' &&
      !showable(str(made.props.text), said)
    if (!cta && !longBlank && !echo && !violates(made, state, props) && fits(made)) return made
  }
  return null
}

/** `c` may take slot `i`: a look and idea new to both neighbours and a look the reel has not shown. */
export function fitsAt(shots: readonly TimedShot[], i: number, c: TimedShot): boolean {
  return (
    [shots[i - 1], shots[i + 1]].every(
      (n) =>
        !n ||
        (lookKey(n) !== lookKey(c) &&
          !echoes(n, c) &&
          (n.show !== c.show || c.show === 'KeyPoint')),
    ) && !shots.some((x, k) => k !== i && lookKey(x) === lookKey(c))
  )
}

/** Seconds by which a shot's own number has been said (a stat leaves only after its number). */
export function heldUntil(s: TimedShot, props: ReelProps, fps: number): number {
  const a = s.from / fps
  const b = (s.from + s.frames) / fps
  const digits = s.show === 'StatSlam' ? /\d[\d,]*(?:\.\d+)?/.exec(str(s.props.value))?.[0] : ''
  if (!digits) return a
  const w = props.words.find((x) => x.start >= a - 0.3 && x.start < b && x.text.includes(digits))
  return w ? w.end + 0.4 : a
}

/** A word start inside `[lo, hi]` seconds, nearest `mid`. */
function cutNear(props: ReelProps, lo: number, hi: number, mid: number): number | null {
  const t = props.words
    .map((w) => w.start)
    .filter((x) => x >= lo && x <= hi)
    .sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid))[0]
  return t ?? null
}

/** Neighbouring shots with one look become one shot (a list or bars keep the first's timing). */
export function mergeRepeats(shots: TimedShot[]): TimedShot[] {
  const out: TimedShot[] = []
  for (const s of shots) {
    const prev = out[out.length - 1]
    if (prev && lookKey(prev) === lookKey(s) && prev.from + prev.frames === s.from) {
      prev.frames += s.frames
      continue
    }
    out.push({ ...s })
  }
  return out
}

/**
 * Hands up to `frames` of `shots[i]` to neighbours with room (each <= 4 s, never caption-only or
 * the end card before it) and shrinks the shot by what was placed; returns frames placed.
 */
function giveAway(
  shots: TimedShot[],
  i: number,
  frames: number,
  fps: number,
  toBlank = true,
): number {
  const max = Math.round(MAX_HOLD_S * fps)
  const s = shots[i]!
  const prev = shots[i - 1]
  const next = shots[i + 1]
  const want = Math.min(frames, s.frames)
  let left = want
  const room = (n: TimedShot) =>
    isCaptionOnly(n) ? (toBlank ? Math.floor(CAPTION_ONLY_MAX_S * fps) : 0) : max
  if (prev && prev.show !== 'EndCard') {
    const n = Math.min(left, Math.max(0, room(prev) - prev.frames))
    prev.frames += n
    s.from += n
    s.frames -= n
    left -= n
  }
  if (next && left > 0 && next.origin !== 'cue') {
    const n = Math.min(left, Math.max(0, room(next) - next.frames))
    next.from -= n
    next.frames += n
    s.frames -= n
    if (Array.isArray(next.props.times))
      next.props = {
        ...next.props,
        times: (next.props.times as number[]).map((t) => Math.round((t + n / fps) * 100) / 100),
      }
    left -= n
  }
  return want - left
}

/** A stock clip no shot of the reel shows yet: a clip never appears twice in one reel. */
function freeClip(shots: readonly TimedShot[], i: number, props: ReelProps): { bg: number } | null {
  const used = new Set(
    shots.flatMap((x, j) => (j !== i && typeof x.props.bg === 'number' ? [x.props.bg] : [])),
  )
  const beat = shots[i]?.sceneIndex
  const free = (props.broll ?? []).flatMap((c, k) => (used.has(k) ? [] : [{ k, beat: c.beat }]))
  const pick = free.find((c) => c.beat === beat) ?? free[0]
  return pick ? { bg: pick.k } : null
}

/** Frames of footage-only screen around `shots[i]` if it became one: itself plus caption-only neighbours. */
function blankRun(shots: readonly TimedShot[], i: number): number {
  let n = shots[i]!.frames
  for (let k = i - 1; k >= 0 && isCaptionOnly(shots[k]!); k -= 1) n += shots[k]!.frames
  for (let k = i + 1; k < shots.length && isCaptionOnly(shots[k]!); k += 1) n += shots[k]!.frames
  return n
}

/**
 * Fills the span of `shots[i]` with something else: a fresh pick or the terms being said, else its
 * time goes to the neighbours, else short stock footage. False (unchanged) when nothing works.
 */
function replace(shots: TimedShot[], i: number, props: ReelProps, fps: number): boolean {
  const s = shots[i]!
  const made = repick(shots, i, props, fps)
  if (made) {
    shots[i] = made
    return true
  }
  let probe = shots.map((x) => ({ ...x }))
  giveAway(probe, i, s.frames, fps)
  if (probe[i]!.frames > 0) {
    probe = shots.map((x) => ({ ...x }))
    giveAway(probe, i, s.frames, fps, false)
  }
  const rest = probe[i]!
  if (rest.frames <= 0) probe.splice(i, 1)
  else {
    const clip = freeClip(probe, i, props)
    const tooLong = rest.frames > CAPTION_ONLY_MAX_S * fps
    if (clip === null || tooLong || blankRun(probe, i) > BLANK_RUN_MAX_S * fps) return false
    probe[i] = {
      ...rest,
      show: 'KeyPoint',
      origin: 'planned',
      props: { text: '', sub: '', ...clip },
    }
  }
  shots.splice(0, shots.length, ...probe)
  return true
}

/**
 * Two neighbours that say one thing: the stronger shows it from where the idea starts, for up to
 * 4 s; what is left of the pair's span gets something else (see `replace`), or the stronger shot
 * keeps it all when nothing fits.
 */
function resolveEcho(shots: TimedShot[], i: number, props: ReelProps, fps: number): void {
  const max = Math.round(MAX_HOLD_S * fps)
  const a = shots[i - 1]!
  const b = shots[i]!
  if (b.origin === 'cue' && weight(b) > weight(a)) {
    // A cue keeps its word: the weaker shot before it gets something else instead.
    if (!replace(shots, i - 1, props, fps))
      shots.splice(i - 1, 2, { ...a, frames: a.frames + b.frames })
    return
  }
  const strong = weight(a) >= weight(b) ? a : b
  const from = a.from
  const span = a.frames + b.frames
  const shift = (strong.from - from) / fps
  const kept: TimedShot = {
    ...strong,
    from,
    frames: Math.min(span, max),
    props: Array.isArray(strong.props.times)
      ? {
          ...strong.props,
          times: (strong.props.times as number[]).map((t) =>
            Math.max(0, Math.round((t + shift) * 100) / 100),
          ),
        }
      : strong.props,
  }
  if (span <= max) {
    shots.splice(i - 1, 2, kept)
    return
  }
  const rest: TimedShot = { ...b, from: from + max, frames: span - max }
  const trial = shots.map((x) => ({ ...x }))
  trial.splice(i - 1, 2, kept, rest)
  if (replace(trial, i, props, fps)) shots.splice(0, shots.length, ...trial)
  else shots.splice(i - 1, 2, { ...kept, frames: span })
}

/**
 * The last pass over the timeline; every rule here is about what the viewer sees:
 * - no key point is a call to action (the end card is), and the end card takes the time before it;
 * - neighbours never share a look (merged) or an idea or number (the weaker one is dropped and the
 *   other covers both spans);
 * - caption-only footage never runs 3 s;
 * - no look holds over 4 s: the rest goes to a fresh pick, the terms being said, its neighbours or
 *   short footage. A card is never restated in a second layout.
 */
export function finalizeShots(input: TimedShot[], props: ReelProps, fps: number): TimedShot[] {
  const max = Math.round(MAX_HOLD_S * fps)
  let shots = input.map((s) =>
    s.show === 'KeyPoint' && isCallToAction(str(s.props.text))
      ? { ...s, props: { ...s.props, text: '', sub: '' } }
      : { ...s },
  )
  const end = shots.findIndex((s) => s.show === 'EndCard')
  if (end > 0) {
    const card = shots[end]!
    const before = shots[end - 1]!
    if (isCaptionOnly(before) && card.frames < max) {
      const n = Math.min(before.frames, max - card.frames)
      card.from -= n
      card.frames += n
      before.frames -= n
    }
  }
  shots = mergeRepeats(shots.filter((s) => s.frames > 0))

  for (let i = 1; i < shots.length; i += 1) {
    const a = shots[i - 1]!
    const b = shots[i]!
    if (a.show === 'EndCard' || b.show === 'EndCard' || !echoes(a, b)) continue
    resolveEcho(shots, i, props, fps)
  }

  for (let i = 0; i < shots.length; i += 1) {
    const s = shots[i]!
    if (!isCaptionOnly(s) || s.frames <= CAPTION_ONLY_MAX_S * fps) continue
    if (replace(shots, i, props, fps)) continue
    const pieces = splitEven(s, props, fps, CAPTION_ONLY_MAX_S - 0.4)
    shots.splice(i, 1, ...pieces)
    // Last piece first: a piece given away to its neighbours is removed, which only shifts later indexes.
    for (let k = pieces.length - 1; k >= 0; k -= 1) {
      if (replace(shots, i + k, props, fps)) continue
      // Still footage: another clip, never the same shot cut in two; out of clips, a new ambient look.
      const clip = freeClip(shots, i + k, props)
      if (clip) shots[i + k] = { ...shots[i + k]!, props: { text: '', sub: '', ...clip } }
      else shots[i + k] = { ...shots[i + k]!, props: { text: '', sub: '', ambient: k + 1 } }
    }
  }

  // The hook's first look is a cut, not a hold: a static card for 4 s loses the viewer.
  const first = shots[0]
  if (
    first &&
    props.scenes[0]?.kind === 'hook' &&
    first.frames > HOOK_FIRST_MAX_S * fps &&
    shots.length > 1
  ) {
    const a = first.from / fps
    const at = cutNear(props, a + MIN_PIECE_S, a + HOOK_FIRST_MAX_S, a + 2)
    const lead =
      at === null ? Math.round(HOOK_FIRST_MAX_S * fps) : Math.round(at * fps) - first.from
    const trial = shots.map((x) => ({ ...x }))
    const rest = { ...first, from: first.from + lead, frames: first.frames - lead }
    trial.splice(0, 1, { ...first, frames: lead }, rest)
    const clip = freeClip(trial, 1, props)
    const made =
      repick(trial, 1, props, fps) ??
      (clip
        ? {
            ...rest,
            show: 'KeyPoint' as ScreenName,
            origin: 'planned' as const,
            props: { text: '', sub: '', ...clip },
          }
        : null)
    if (made) {
      trial[1] = made
      shots.splice(0, shots.length, ...trial)
    }
  }

  for (let pass = 0; pass < 6; pass += 1) {
    for (let i = 0; i < shots.length; i += 1) {
      const s = shots[i]!
      if (s.frames <= max) continue
      // The rest gets a new look (never the same card in a second layout), cut on a word.
      const a = s.from / fps
      const b = (s.from + s.frames) / fps
      const lo = Math.max(a + MIN_PIECE_S, heldUntil(s, props, fps))
      const at = cutNear(props, lo, Math.min(a + MAX_HOLD_S, b - 1), Math.max(lo, (a + b) / 2))
      const lead = Math.min(max, at === null ? max : Math.round(at * fps) - s.from)
      const head = { ...s, frames: lead }
      shots.splice(i, 1, head, { ...s, from: s.from + lead, frames: s.frames - lead })
      if (replace(shots, i + 1, props, fps)) continue
      const pieces = splitEven(shots[i + 1]!, props, fps, CAPTION_ONLY_MAX_S - 0.4)
      const trial = shots.map((x) => ({ ...x }))
      trial.splice(i + 1, 1, ...pieces)
      let ok = true
      for (let k = pieces.length - 1; k >= 0 && ok; k -= 1) {
        if (replace(trial, i + 1 + k, props, fps)) continue
        const at = i + 1 + k
        const piece = trial[at]!
        if (!isCaptionOnly(piece)) {
          ok = false
          continue
        }
        const clip = freeClip(trial, at, props)
        trial[at] = { ...piece, props: { text: '', sub: '', ...(clip ?? { ambient: k + 1 }) } }
      }
      if (ok) shots.splice(0, shots.length, ...trial)
      else shots.splice(i, 2, s)
    }
  }
  return contiguous(absorbTiny(mergeRepeats(shots), fps))
}

/** `s` cut on word starts into pieces of about `target` seconds or less. */
function splitEven(s: TimedShot, props: ReelProps, fps: number, target: number): TimedShot[] {
  const n = Math.ceil(s.frames / fps / target)
  if (n <= 1) return [s]
  const a = s.from / fps
  const step = s.frames / fps / n
  const cuts: number[] = []
  for (let k = 1; k < n; k += 1) {
    const want = a + k * step
    const at = cutNear(props, want - step / 3, want + step / 3, want) ?? want
    cuts.push(Math.round(at * fps))
  }
  const edges = [s.from, ...cuts, s.from + s.frames]
  return edges.slice(0, -1).map((from, k) => ({ ...s, from, frames: edges[k + 1]! - from }))
}

/** `s` starting `n` frames later (timed list or bar marks keep their words). */
function shiftStart(s: TimedShot, n: number, fps: number): TimedShot {
  const times = Array.isArray(s.props.times)
    ? (s.props.times as number[]).map((t) => Math.max(0, Math.round((t - n / fps) * 100) / 100))
    : undefined
  return {
    ...s,
    from: s.from + n,
    frames: s.frames - n,
    props: times ? { ...s.props, times } : s.props,
  }
}

const ASSET = new Set<ScreenName>(['FigureZoom', 'ImageFull', 'ArticleHeadline', 'YouTubePlayer'])

/** Shots under 0.8 s read as a glitch: they join the shot before (or after) when it has room. */
function absorbTiny(shots: TimedShot[], fps: number): TimedShot[] {
  const min = Math.round(0.8 * fps)
  const max = Math.round(MAX_HOLD_S * fps)
  const out: TimedShot[] = []
  for (let i = 0; i < shots.length; i += 1) {
    const s = shots[i]!
    const prev = out[out.length - 1]
    const next = shots[i + 1]
    if (s.frames < min && s.origin === 'cue' && next && next.origin !== 'cue') {
      // A cue keeps its word: it takes time from the shot after it rather than vanish.
      const take = Math.min(min - s.frames, next.frames)
      const rest = next.frames - take
      out.push({ ...s, frames: s.frames + (rest < min ? next.frames : take) })
      if (rest < min) i += 1
      else shots[i + 1] = shiftStart(next, take, fps)
      continue
    }
    const need = min - s.frames
    if (
      s.frames < min &&
      ASSET.has(s.show) &&
      prev &&
      prev.show !== 'EndCard' &&
      prev.frames - need >= Math.round(MIN_PIECE_S * fps)
    ) {
      // A real image is worth seeing: it takes time from the shot before rather than vanish.
      prev.frames -= need
      out.push({ ...s, from: s.from - need, frames: min })
      continue
    }
    if (s.frames >= min || s.show === 'EndCard') out.push(s)
    else if (prev && prev.show !== 'EndCard' && prev.frames + s.frames <= max)
      prev.frames += s.frames
    else if (next && next.frames + s.frames <= max) {
      shots[i + 1] = { ...next, from: s.from, frames: next.frames + s.frames }
    } else out.push(s)
  }
  return out
}

/** Shots tile the timeline: each starts where the one before ends. */
function contiguous(shots: TimedShot[]): TimedShot[] {
  return shots
    .filter((s) => s.frames > 0)
    .map((s, i, all) => {
      const next = all[i + 1]
      return next ? { ...s, frames: next.from - s.from } : s
    })
}

/**
 * A list or terms card of two or more items over 2.6 s, as two cards cut where an item is said:
 * each shows only its own items and the second uses the other list layout, so the cut is new.
 */
export function splitList(s: TimedShot, fps: number): TimedShot[] | null {
  const items = Array.isArray(s.props.items) ? (s.props.items as unknown[]).map(str) : []
  if (s.props.layout !== undefined) return null
  const times = Array.isArray(s.props.times) ? (s.props.times as number[]) : []
  const len = s.frames / fps
  if (s.show !== 'KeyPoint' || items.length < 4 || times.length !== items.length || len < 2.6)
    return null
  const ok = (k: number) => times[k]! - 0.1 >= 1.0 && len - (times[k]! - 0.1) >= 1.0
  const k = [...items.keys()]
    .slice(2, items.length - 1)
    .filter(ok)
    .sort((a, b) => Math.abs(times[a]! - len / 2) - Math.abs(times[b]! - len / 2))[0]
  if (k === undefined) return null
  const cut = Math.round((times[k]! - 0.1) * fps)
  const shift = cut / fps
  return [
    {
      ...s,
      frames: cut,
      props: { ...s.props, items: items.slice(0, k), times: times.slice(0, k) },
    },
    {
      ...s,
      from: s.from + cut,
      frames: s.frames - cut,
      origin: 'planned',
      sfx: 'pop',
      props: {
        ...s.props,
        items: items.slice(k),
        times: times.slice(k).map((t) => Math.max(0, Math.round((t - shift) * 100) / 100)),
        layout: 1,
        bg: undefined,
        bgAt: undefined,
      },
    },
  ]
}

/** Screens whose timing is tied to the voice or the end: never cut for pace. */
const FIXED = new Set<ScreenName>(['EndCard', 'RepoDemo', 'BarRace', 'TableScreen', 'Terminal'])

/**
 * Keeps the cutting pace (average shot <= 2.4 s) without a cut that shows the same thing again:
 * the longest holds hand their second part to a fresh pick (a new idea, never the same card
 * restated), else a stock cutaway.
 */
export function paceShots(input: TimedShot[], props: ReelProps, fps: number): TimedShot[] {
  const total = input.reduce((n, s) => n + s.frames, 0)
  let need = Math.ceil(total / fps / PACE_S) - input.length
  if (need <= 0) return input
  const shots = input.map((s) => ({ ...s }))
  const order = shots
    .map((s, i) => ({ s, i }))
    .sort((a, b) => b.s.frames - a.s.frames)
    .map((x) => x.s)
  for (const s of order) {
    if (need <= 0) break
    const i = shots.indexOf(s)
    if (i < 0 || s.frames < 2 * MIN_PIECE_S * fps + 6) continue
    const kin = [shots[i - 1], shots[i + 1]].some(
      (x) => x && str(x.props.kicker) && x.props.kicker === s.props.kicker,
    )
    const halves = kin ? null : splitList(s, fps)
    if (halves) {
      shots.splice(i, 1, ...halves)
      need -= 1
      continue
    }
    if (isCaptionOnly(s) && s.frames >= 2 * MIN_PIECE_S * fps) {
      // Footage cut to a second clip: a montage beat, not the same shot again.
      const a = s.from / fps
      const b = (s.from + s.frames) / fps
      const at = cutNear(props, a + MIN_PIECE_S, b - MIN_PIECE_S, (a + b) / 2)
      if (at === null) continue
      const lead = Math.round(at * fps) - s.from
      const trial = [...shots]
      trial.splice(
        i,
        1,
        { ...s, frames: lead },
        { ...s, from: s.from + lead, frames: s.frames - lead },
      )
      const clip = freeClip(trial, i + 1, props)
      if (!clip) continue
      trial[i + 1] = { ...trial[i + 1]!, props: { text: '', sub: '', ...clip } }
      shots.splice(0, shots.length, ...trial)
      need -= 1
      continue
    }
    if (FIXED.has(s.show) || Array.isArray(s.props.items) || isCaptionOnly(s)) continue
    if (s.frames < 3.1 * fps) continue
    const a = s.from / fps
    const b = (s.from + s.frames) / fps
    const lo = Math.max(a + 1.8, heldUntil(s, props, fps))
    const at = cutNear(props, lo, b - MIN_PIECE_S, Math.max(lo, a + (b - a) * 0.55))
    if (at === null) continue
    const lead = Math.round(at * fps) - s.from
    const trial = [...shots]
    trial.splice(
      i,
      1,
      { ...s, frames: lead },
      { ...s, from: s.from + lead, frames: s.frames - lead },
    )
    const clip = freeClip(trial, i + 1, props)
    const made =
      repick(trial, i + 1, props, fps) ??
      (clip &&
      trial[i + 1]!.frames <= CAPTION_ONLY_MAX_S * fps &&
      blankRun(trial, i + 1) <= BLANK_RUN_MAX_S * fps
        ? {
            ...trial[i + 1]!,
            show: 'KeyPoint' as ScreenName,
            origin: 'planned' as const,
            props: { text: '', sub: '', ...clip },
          }
        : null)
    if (!made) continue
    trial[i + 1] = made
    shots.splice(0, shots.length, ...trial)
    need -= 1
  }
  return shots
}

/** All demo cuts together run about this long (the cuts add up to 3-5 s). */
const DEMO_TOTAL_S = 4.6
const GIVES = new Set<ScreenName>([
  'KeyPoint',
  'FigureZoom',
  'ImageFull',
  'ArticleHeadline',
  'PaperPage',
  'HNThread',
  'RedditPost',
  'YouTubePlayer',
  'RepoPage',
])

/**
 * The README demo is the product: all its cuts together play 3-4.6 s (see `RepoDemo`), taking the
 * time from the shots around it that can spare it (never a stat, bars, a cue or the end card, and
 * each keeps at least 1.2 s).
 */
export function stretchDemo(input: TimedShot[], fps: number, props?: ReelProps): TimedShot[] {
  const shots = input.map((s) => ({ ...s }))
  const demos = shots.filter((s) => s.show === 'RepoDemo')
  const last = demos[demos.length - 1]
  if (!last) return shots
  const i = shots.indexOf(last)
  const have = demos.reduce((n, s) => n + s.frames, 0)
  const target = Math.round(Math.min(DEMO_MAX_S, Math.max(DEMO_MIN_S, DEMO_TOTAL_S)) * fps)
  const keep = Math.round(MIN_PIECE_S * fps)
  const spare = (n: TimedShot | undefined) =>
    n && n.origin !== 'cue' && GIVES.has(n.show) && !Array.isArray(n.props.items)
      ? Math.max(0, n.frames - keep)
      : 0
  let need = target - have
  if (have > Math.round(DEMO_MAX_S * fps)) {
    // Too long (the planner gave it 4 s on top of the hook cut): the last cut gives time back.
    const give = Math.min(have - target, Math.max(0, last.frames - keep))
    // A piece under 0.8 s reads as a glitch: leave a demo that is a hair too long.
    if (give < Math.round(0.8 * fps)) return shots
    const after = shots[i + 1]
    const room = (n: TimedShot | undefined) =>
      n && n.show !== 'EndCard' && !Array.isArray(n.props.times) && n.frames + give <= 4 * fps
    if (give > 0 && after && after.origin !== 'cue' && room(after)) {
      last.frames -= give
      after.from -= give
      after.frames += give
    } else if (give > 0) {
      // Nothing next to it can take the time (the end card, a stat): footage takes it.
      const rest: TimedShot = {
        ...last,
        show: 'KeyPoint',
        from: last.from + last.frames - give,
        frames: give,
        origin: 'planned',
        props: { text: '', sub: '' },
      }
      last.frames -= give
      const clip = props ? freeClip(shots, i, props) : null
      rest.props = { text: '', sub: '', ...(clip ?? { ambient: 1 }) }
      shots.splice(i + 1, 0, rest)
    }
    return shots
  }
  if (need <= 0) return shots
  const next = shots[i + 1]
  const fromNext = Math.min(need, spare(next))
  if (next && fromNext > 0) {
    next.from += fromNext
    next.frames -= fromNext
    last.frames += fromNext
    need -= fromNext
  }
  const prev = shots[i - 1]
  const fromPrev = Math.min(need, spare(prev))
  if (prev && fromPrev > 0) {
    prev.frames -= fromPrev
    last.from -= fromPrev
    last.frames += fromPrev
  }
  return shots
}
