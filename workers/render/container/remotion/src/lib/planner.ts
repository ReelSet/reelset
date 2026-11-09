import { findNumbers, keyPhraseIn, salientPhrase, sentences, shellLines, versusPair } from './extract'
import type { ReelImage, ReelProps, Scene, ScreenName, SfxName, TimedShot, Word } from './types'

export const MIN_SHOT_S = 1.5
export const MAX_SHOT_S = 2.5
export const TARGET_SHOT_S = 2.0
export const MAX_HOLD_S = 4
export const IMAGE_EVERY_S = 5.5

export type PlanState = {
  history: ScreenName[]
  lastImageAt: number
  imageCursor: number
  beatShots: number
  thumbUsed: boolean
}

export const newState = (): PlanState => ({
  history: [],
  lastImageAt: -Infinity,
  imageCursor: 0,
  beatShots: 0,
  thumbUsed: false,
})

export type Chunk = { start: number; end: number }

/** Cut `[t0, t1)` into chunks of 1.5-2.5 s that end on word boundaries, preferring punctuation. */
export function chunkSpan(words: readonly Word[], t0: number, t1: number): Chunk[] {
  const inside = words.filter((w) => w.start >= t0 - 0.01 && w.start < t1)
  const cuts: { t: number; punct: boolean }[] = inside.slice(1).map((w, k) => ({
    t: w.start,
    punct: /[.?!,;:]$/.test(inside[k]?.text ?? ''),
  }))
  const out: Chunk[] = []
  let cur = t0
  while (t1 - cur > MAX_SHOT_S + 0.01) {
    const viable = (lo: number, hi: number) =>
      cuts.filter((c) => c.t - cur >= lo && c.t - cur <= hi && (t1 - c.t >= 1 || t1 - c.t === 0))
    let pool = viable(MIN_SHOT_S, MAX_SHOT_S)
    if (pool.length === 0) pool = viable(1.1, 3.2)
    const best = [...pool].sort(
      (a, b) =>
        Math.abs(a.t - cur - TARGET_SHOT_S) - (a.punct ? 0.6 : 0) -
        (Math.abs(b.t - cur - TARGET_SHOT_S) - (b.punct ? 0.6 : 0)),
    )[0]
    const next = best ? best.t : cur + TARGET_SHOT_S
    out.push({ start: cur, end: next })
    cur = next
  }
  if (t1 - cur > 0.001) {
    if (out.length > 0 && t1 - cur < 1.0) out[out.length - 1] = { start: out[out.length - 1]!.start, end: t1 }
    else out.push({ start: cur, end: t1 })
  }
  return out
}

export type PlanCtx = {
  props: ReelProps
  fps: number
}

const unitOf = (raw: string) => raw.replace(/[\d.,~+$\s]|up to|over|about|nearly/gi, '').toLowerCase()

const textOf = (words: readonly Word[], c: Chunk) =>
  words.filter((w) => w.start >= c.start - 0.01 && w.start < c.end).map((w) => w.text).join(' ')

type Candidate = { show: ScreenName; props: Record<string, unknown>; score: number }

const IMAGE_SCREENS = new Set<ScreenName>(['ImageFull', 'FigureZoom', 'YouTubePlayer', 'ArticleHeadline'])
const SOURCE_SCREEN: Record<ReelProps['source'], ScreenName> = {
  github: 'RepoPage',
  hn: 'HNThread',
  reddit: 'RedditPost',
  youtube: 'YouTubePlayer',
  papers: 'PaperPage',
  news: 'ArticleHeadline',
}

function imageScreen(
  source: ReelProps['source'],
  img: ReelImage,
  repeat: boolean,
): ScreenName {
  if (repeat) return 'ImageFull'
  if (img.kind === 'figure') return 'FigureZoom'
  if (img.kind === 'thumbnail' && source === 'youtube') return 'YouTubePlayer'
  if ((img.kind === 'og' || img.kind === 'screenshot') && (source === 'news' || source === 'hn')) {
    return 'ArticleHeadline'
  }
  return 'ImageFull'
}

const HERO_ORDER: ReelImage['kind'][] = ['thumbnail', 'og', 'screenshot', 'figure', 'avatar']

export function usableImages(images: readonly ReelImage[] | undefined, skipThumbnails = false): number[] {
  const list = images ?? []
  return list
    .map((img, i) => ({ img, i }))
    .filter(({ img }) => img.kind !== 'avatar' && !(skipThumbnails && img.kind === 'thumbnail'))
    .sort((a, b) => HERO_ORDER.indexOf(a.img.kind) - HERO_ORDER.indexOf(b.img.kind) || a.i - b.i)
    .map(({ i }) => i)
}

// One sfx per cut. The container mix adds a riser lead-in before every 'ding'.
function sfxFor(show: ScreenName, index: number, prev: ScreenName | undefined): SfxName {
  if (index === 0) return 'hit'
  if (show === 'StatSlam' || show === 'EndCard') return 'ding'
  if (show === 'BarRace' || show === 'Terminal' || show === 'CodeBlock') return 'tick'
  if (show === 'KeyPoint') return 'hit'
  if (IMAGE_SCREENS.has(show)) return prev && IMAGE_SCREENS.has(prev) ? 'whoosh' : 'pop'
  return index % 2 === 0 ? 'whoosh' : 'pop'
}

export function pickShot(
  ctx: PlanCtx,
  scene: Scene,
  sceneIndex: number,
  chunk: Chunk,
  isFirstInScene: boolean,
  isLastInScene: boolean,
  atSeconds: number,
  state: PlanState,
): { show: ScreenName; props: Record<string, unknown> } {
  const { props } = ctx
  const text = textOf(props.words, chunk) || ('text' in scene ? scene.text : '')
  const sceneText = 'text' in scene ? scene.text : ''
  const visual = scene.kind === 'beat' ? scene.visual : undefined
  const images = usableImages(props.images, state.thumbUsed)
  const prev = state.history[state.history.length - 1]
  const cands: Candidate[] = []
  const add = (show: ScreenName, p: Record<string, unknown>, score: number) => cands.push({ show, props: p, score })

  if (scene.kind === 'outro' && isLastInScene) {
    return { show: 'EndCard', props: {} }
  }

  const imageDue = images.length > 0 && atSeconds - state.lastImageAt >= IMAGE_EVERY_S
  if (images.length > 0) {
    const idx = images[state.imageCursor % images.length]!
    const repeat = state.imageCursor >= images.length
    const img = props.images![idx]!
    const show = imageScreen(props.source, img, repeat)
    add(show, { image: idx, variant: state.imageCursor }, imageDue ? 12 : 0.6 + (isFirstInScene && scene.kind === 'hook' ? 8 : 0))
  }

  add(SOURCE_SCREEN[props.source], { focus: sceneIndex }, scene.kind === 'hook' && isFirstInScene ? 5 : 1.8)

  const nums = findNumbers(text)
  const beatNums = findNumbers(sceneText)
  if (visual?.type === 'stat') {
    add('StatSlam', { value: visual.value, label: visual.label }, isFirstInScene ? 9 : 3)
  } else if (nums[0]) {
    add('StatSlam', { value: nums[0].raw, label: nums[0].label }, 5)
  }
  if (beatNums.length >= 2) {
    const [a, b] = beatNums
    if (a && b && a.unit && b.unit && a.label && b.label && unitOf(a.raw) === unitOf(b.raw)) {
      add(
        'BarRace',
        {
          bars: [
            { label: a.label || 'A', value: a.raw },
            { label: b.label || 'B', value: b.raw },
          ],
        },
        2.5,
      )
    }
  }
  const pair = versusPair(text) ?? versusPair(sceneText)
  if (pair) add('Compare', { left: pair[0], right: pair[1] }, 4.5)

  if (visual?.type === 'code') {
    const sh = shellLines(visual.code)
    if (sh) add('Terminal', { lines: sh }, isFirstInScene ? 9 : 3)
    else add('CodeBlock', { code: visual.code, language: visual.language }, isFirstInScene ? 9 : 3)
  } else if (props.source === 'github' && /\b(install|clone|run|command|cli|npx|npm|pip|terminal|setup)\b/i.test(text)) {
    add('Terminal', { lines: [] }, 3.4)
  }
  if (visual?.type === 'title') {
    add('KeyPoint', { text: visual.title, sub: visual.subtitle ?? '' }, isFirstInScene ? 7 : 2.5)
  }
  if (visual?.type === 'quote') {
    const show: ScreenName = props.source === 'hn' ? 'HNThread' : 'KeyPoint'
    add(show, { quote: visual.text, by: visual.attribution, text: visual.text, sub: visual.attribution }, isFirstInScene ? 8 : 3)
  }
  add('KeyPoint', { text: salientPhrase(text), sub: '' }, 1.6)

  let best: Candidate | undefined
  for (const c of cands) {
    let s = c.score
    if (c.show === prev) s -= 100
    s -= 2.2 * state.history.slice(-5).filter((h) => h === c.show).length
    if (c.show === 'KeyPoint' && state.history.slice(-2).includes('KeyPoint')) s -= 1.5
    if (!best || s > best.score) best = { ...c, score: s }
  }
  const chosen = best ?? { show: 'KeyPoint' as ScreenName, props: { text: salientPhrase(text), sub: '' }, score: 0 }
  return { show: chosen.show, props: chosen.props }
}

function register(state: PlanState, show: ScreenName, atSeconds: number, kind?: ReelImage['kind']) {
  state.history.push(show)
  if (IMAGE_SCREENS.has(show)) {
    state.lastImageAt = atSeconds
    state.imageCursor += 1
    if (kind === 'thumbnail' || show === 'YouTubePlayer') state.thumbUsed = true
  }
}

const imageOf = (props: ReelProps, shotProps: Record<string, unknown>): ReelImage | undefined =>
  props.images?.[typeof shotProps.image === 'number' ? shotProps.image : 0]

/** A thumbnail is shown big once (player screen); later shots that would reuse it become a key point. */
export function limitThumbnailReuse(shots: TimedShot[], props: ReelProps, fps = 30): TimedShot[] {
  let used = false
  return shots.map((shot) => {
    const isThumb =
      shot.show === 'YouTubePlayer' ||
      (IMAGE_SCREENS.has(shot.show) && imageOf(props, shot.props)?.kind === 'thumbnail')
    if (!isThumb) return shot
    if (!used) {
      used = true
      return shot
    }
    const t0 = shot.from / fps
    const text = textOf(props.words, { start: t0, end: t0 + shot.frames / fps })
    return { ...shot, show: 'KeyPoint' as ScreenName, props: { text: salientPhrase(text), sub: '' } }
  })
}

/** Plan shots for `[t0, t1)` seconds of one scene. Deterministic for the same props. */
export function planRange(
  ctx: PlanCtx,
  scene: Scene,
  sceneIndex: number,
  t0: number,
  t1: number,
  state: PlanState,
  opts: { lastInScene: boolean; firstInScene: boolean },
): TimedShot[] {
  const chunks = chunkSpan(ctx.props.words, t0, t1)
  return chunks.map((chunk, k) => {
    const first = opts.firstInScene && k === 0
    const last = opts.lastInScene && k === chunks.length - 1
    const at = chunk.start
    const picked = pickShot(ctx, scene, sceneIndex, chunk, first, last, at, state)
    const sfx = sfxFor(picked.show, state.history.length, state.history[state.history.length - 1])
    register(state, picked.show, at, imageOf(ctx.props, picked.props)?.kind)
    state.beatShots += 1
    const from = Math.round(chunk.start * ctx.fps)
    return {
      from,
      frames: Math.max(1, Math.round(chunk.end * ctx.fps) - from),
      show: picked.show,
      props: picked.props,
      sfx,
      sceneIndex,
      origin: 'planned' as const,
    }
  })
}

export function planFirstSentence(text: string): string {
  return sentences(text)[0] ?? text
}

export { keyPhraseIn }
