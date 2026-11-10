import { related } from './ideas'
import { isSetupNumber } from './ground'
import { showable } from './caption-echo'
import { isBrandImage } from './images'
import { styleOf } from './typeset'
import { keyPhraseIn, sentences, shellLines, spokenCommand, versusPair } from './extract'
import { barProps, namesOf, quantitiesOf, sentenceFor, spokenIn } from './numbers'
import {
  SOURCE_SCREENS,
  commentFor,
  isSourcedQuote,
  nextVariant,
  repoCardSparse,
  variantOf,
} from './sources'
import {
  carriesQuantity,
  isClaimLike,
  isCompleteCodeLine,
  keyPointOptions,
  quantityValue,
  validKeyPoint,
} from './text-rules'
import type { ReelImage, ReelProps, Scene, ScreenName, SfxName, TimedShot, Word } from './types'

export const MIN_SHOT_S = 1.5
export const MAX_SHOT_S = 2.5
export const TARGET_SHOT_S = 2.0
export const MAX_HOLD_S = 4
export const IMAGE_EVERY_S = 5.5

export type PlanState = {
  history: ScreenName[]
  looks: string[]
  lastImageAt: number
  imageCursor: number
  beatShots: number
  thumbUsed: boolean
  uses: Record<string, number>
  imageUses: Record<number, number>
  bgTaken: number[]
  sourceUsed: Record<string, string[]>
  keyTexts: Set<string>
  statValues: Set<number>
  identities: string[]
  /** Identities and key point texts of cue shots not placed yet; planned shots must not take them. */
  reserved: Map<string, number>
  reservedTexts: Set<string>
}

export const CAP_PER_SCREEN = 2
/** A hero image or screenshot appears once; a wide figure may return once in a different crop. */
export const imageCap = (img: ReelImage | undefined): number => (img?.kind === 'figure' ? 2 : 1)
export const NO_REPEAT_WITHIN = 3
/** Longest a shot may be stretched when nothing new is left to show (QA limit is 4 s). */
export const FOLD_MAX_S = 3.5
export const capFor = (show: ScreenName): number =>
  show === 'EndCard' || show === 'RepoDemo' || SOURCE_SCREENS.has(show) ? 1 : CAP_PER_SCREEN
/** Narration that points at the demo ("watch the tour") is shown over the demo itself. */
export const DEMO_CUE = /\b(watch|tour|demo|in action|see it)\b/i

/** The model's key point text, kept only when it is a valid claim (see text-rules `isClaimLike`). */
export function givenKeyPoint(props: ReelProps, text: unknown, sub: unknown = ''): string | null {
  if (typeof text !== 'string' || !isClaimLike(text, typeof sub === 'string' ? sub : ''))
    return null
  return validKeyPoint(text, {
    names: namesOf(props),
    allowVerbStart: true,
    allowParticipleStart: true,
  })
}
/** The beat's own readable statements (script `keyPoints`) that are valid claims, in the model's order. */
export function beatKeyPoints(props: ReelProps, scene: Scene | undefined): string[] {
  if (!scene || scene.kind !== 'beat') return []
  return (scene.keyPoints ?? []).flatMap((k) => {
    const t = givenKeyPoint(props, k)
    return t ? [t] : []
  })
}

/** KeyPoint layouts look different (left, uppercase, right), so each counts as its own look; source cards count per variant. */
export function varietyKey(show: ScreenName, props: Record<string, unknown>): string {
  const bg = typeof props.bg === 'number' ? `+bg${props.bg}` : ''
  if (SOURCE_SCREENS.has(show)) return `${show}/${variantOf(props) ?? 'title'}`
  if (show !== 'KeyPoint') return `${show}${bg}`
  const text = typeof props.text === 'string' ? props.text : ''
  if (Array.isArray(props.items)) return 'KeyPoint/list'
  if (!text && !props.quote) return `KeyPoint/plain${bg}`
  return `KeyPoint/${props.quote ? 'q' : styleOf(text)}${bg}`
}

const norm = (v: unknown) =>
  typeof v === 'string' ? v.toLowerCase().replace(/\s+/g, ' ').trim() : ''

/** What the viewer actually sees: two shots with the same identity look identical. */
export function identityOf(show: ScreenName, props: Record<string, unknown>): string {
  if (props.punch) return `${identityOf(show, { ...props, punch: undefined })}/punch`
  if (SOURCE_SCREENS.has(show)) return `${show}/${variantOf(props) ?? 'title'}`
  switch (show) {
    case 'KeyPoint':
      if (Array.isArray(props.items))
        return `KeyPoint/list/${JSON.stringify(props.items)}/${JSON.stringify(props.times)}`
      return props.quote
        ? `KeyPoint/q/${norm(props.quote)}`
        : `KeyPoint/${norm(props.text)}/${typeof props.bg === 'number' ? props.bg : ''}`
    case 'StatSlam':
      return `StatSlam/${quantityValue(String(props.value ?? '')) ?? norm(props.value)}`
    case 'CodeBlock':
      return `Code/${norm(props.code)}`
    case 'Terminal':
      return `Code/${norm(Array.isArray(props.lines) ? props.lines.join(' ') : '')}`
    case 'TableScreen':
      return `TableScreen/${norm(props.ref)}/${props.hi}/${props.col}${props.plain ? '/plain' : ''}`
    case 'ImageFull':
    case 'FigureZoom':
      return `${show}/${typeof props.image === 'number' ? props.image : 0}/${typeof props.variant === 'number' ? props.variant % 4 : 0}`
    case 'ArticleHeadline':
      return `${show}/${typeof props.image === 'number' ? props.image : 0}`
    case 'RepoDemo':
      return 'RepoDemo'
    case 'BarRace':
      return `BarRace/${JSON.stringify(props.bars ?? [])}/${JSON.stringify(props.times ?? [])}`
    default:
      return `${show}/${JSON.stringify({ ...props, bg: undefined, variant: undefined, focus: undefined })}`
  }
}

/** Same screen within 3 shots; KeyPoint layouts are different looks, so only an identical look or the previous cut counts. */
export function recentLook(
  state: PlanState,
  show: ScreenName,
  props: Record<string, unknown>,
  prev: ScreenName | undefined,
): boolean {
  if (show === 'KeyPoint' && prev !== 'KeyPoint') {
    return state.looks.slice(-NO_REPEAT_WITHIN).includes(varietyKey(show, props))
  }
  if (show === 'StatSlam' && prev !== 'StatSlam') {
    return state.identities.slice(-NO_REPEAT_WITHIN).includes(identityOf(show, props))
  }
  return state.history.slice(-NO_REPEAT_WITHIN).includes(show)
}

export const newState = (): PlanState => ({
  history: [],
  looks: [],
  lastImageAt: -Infinity,
  imageCursor: 0,
  beatShots: 0,
  thumbUsed: false,
  uses: {},
  imageUses: {},
  bgTaken: [],
  sourceUsed: {},
  keyTexts: new Set(),
  statValues: new Set(),
  identities: [],
  reserved: new Map(),
  reservedTexts: new Set(),
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
        Math.abs(a.t - cur - TARGET_SHOT_S) -
        (a.punct ? 0.6 : 0) -
        (Math.abs(b.t - cur - TARGET_SHOT_S) - (b.punct ? 0.6 : 0)),
    )[0]
    const next = best ? best.t : cur + TARGET_SHOT_S
    out.push({ start: cur, end: next })
    cur = next
  }
  if (t1 - cur > 0.001) {
    if (out.length > 0 && t1 - cur < 1.0)
      out[out.length - 1] = { start: out[out.length - 1]!.start, end: t1 }
    else out.push({ start: cur, end: t1 })
  }
  return out
}

export type PlanCtx = {
  props: ReelProps
  fps: number
}

const unitOf = (raw: string) =>
  raw.replace(/[\d.,~+$\s]|up to|over|about|nearly/gi, '').toLowerCase()

const textOf = (words: readonly Word[], c: Chunk) =>
  words
    .filter((w) => w.start >= c.start - 0.01 && w.start < c.end)
    .map((w) => w.text)
    .join(' ')

/** Marks every cue shot's look as taken so planned shots (and re-picks) leave it to the cue. */
export function reserveCues(
  state: PlanState,
  props: ReelProps,
  shots?: readonly TimedShot[],
): void {
  const cues: { show: ScreenName; props: Record<string, unknown> }[] = shots
    ? shots.filter((s) => s.origin === 'cue')
    : props.scenes.flatMap((sc) =>
        (sc.shots ?? []).map((s) => ({ show: s.show, props: s.props ?? {} })),
      )
  for (const c of cues) {
    const id = identityOf(c.show, c.props)
    state.reserved.set(id, (state.reserved.get(id) ?? 0) + 1)
    if (c.show === 'KeyPoint') {
      const t = givenKeyPoint(props, c.props.text, c.props.sub)
      if (t) state.reservedTexts.add(t.toLowerCase())
    }
    const values =
      c.show === 'StatSlam'
        ? [c.props.value]
        : c.show === 'BarRace' && Array.isArray(c.props.bars)
          ? (c.props.bars as { value?: unknown }[]).map((b) => b.value)
          : []
    for (const raw of values) {
      const v = quantityValue(String(raw ?? ''))
      if (v !== null) state.reserved.set(`value/${v}`, (state.reserved.get(`value/${v}`) ?? 0) + 1)
    }
  }
}

const release = (state: PlanState, key: string) => {
  const n = state.reserved.get(key) ?? 0
  if (n <= 1) state.reserved.delete(key)
  else state.reserved.set(key, n - 1)
}

/** Key point text for a span of narration (see text-rules `keyPointText`), or null. */
export function keyPointFor(
  props: ReelProps,
  sceneText: string,
  spoken: string,
  state: (Pick<PlanState, 'keyTexts'> & Partial<Pick<PlanState, 'reservedTexts'>>) | null,
  given?: string,
  n = 1,
  sub?: string,
): string[] {
  return keyPointOptions(
    {
      given,
      sub,
      claims: props.claims,
      text: spoken,
      context: sentenceFor(sceneText, spoken),
      names: namesOf(props),
      avoid: state ? new Set([...state.keyTexts, ...(state.reservedTexts ?? [])]) : undefined,
    },
    n,
  )
}

/** Code worth showing: every line complete (no "v=" fragments); otherwise null. */
export function completeCode(code: unknown): string | null {
  if (typeof code !== 'string') return null
  const lines = code
    .replace(/\s+$/, '')
    .split('\n')
    .filter((l) => l.trim())
  if (lines.length === 0 || !lines.every(isCompleteCodeLine)) return null
  return lines.join('\n')
}

type Candidate = { show: ScreenName; props: Record<string, unknown>; score: number }

const IMAGE_SCREENS = new Set<ScreenName>([
  'ImageFull',
  'FigureZoom',
  'YouTubePlayer',
  'ArticleHeadline',
])
const SOURCE_SCREEN: Record<ReelProps['source'], ScreenName> = {
  github: 'RepoPage',
  hn: 'HNThread',
  reddit: 'RedditPost',
  youtube: 'YouTubePlayer',
  papers: 'PaperPage',
  news: 'ArticleHeadline',
}

/** Screens that can show this image, best first; each has its own cap so one image can appear twice. */
function imageScreens(
  source: ReelProps['source'],
  img: ReelImage,
  repeat: boolean,
  thumbUsed: boolean,
): ScreenName[] {
  const base: ScreenName[] =
    img.kind === 'figure'
      ? ['FigureZoom']
      : img.kind === 'thumbnail' && source === 'youtube' && !thumbUsed
        ? ['YouTubePlayer', 'ImageFull']
        : (img.kind === 'og' || img.kind === 'screenshot') && (source === 'news' || source === 'hn')
          ? ['ArticleHeadline', 'ImageFull']
          : ['ImageFull', 'ArticleHeadline']
  return repeat ? [...base].reverse() : base
}

const HERO_ORDER: ReelImage['kind'][] = ['thumbnail', 'og', 'screenshot', 'figure', 'avatar']

export function usableImages(
  images: readonly ReelImage[] | undefined,
  skipThumbnails = false,
  story?: { title: string; domain: string },
): number[] {
  const list = images ?? []
  return list
    .map((img, i) => ({ img, i }))
    .filter(({ img }) => img.kind !== 'avatar' && !(skipThumbnails && img.kind === 'thumbnail'))
    .filter(({ img }) => !story || !isBrandImage(img, story.title, story.domain))
    .sort((a, b) => HERO_ORDER.indexOf(a.img.kind) - HERO_ORDER.indexOf(b.img.kind) || a.i - b.i)
    .map(({ i }) => i)
}

// One sfx per cut. The container mix adds a riser lead-in before every 'ding'.
export function sfxFor(show: ScreenName, index: number, prev: ScreenName | undefined): SfxName {
  if (index === 0) return 'hit'
  if (show === 'StatSlam' || show === 'EndCard') return 'ding'
  if (show === 'BarRace' || show === 'Terminal' || show === 'CodeBlock') return 'tick'
  if (show === 'KeyPoint') return 'hit'
  if (IMAGE_SCREENS.has(show)) return prev && IMAGE_SCREENS.has(prev) ? 'whoosh' : 'pop'
  return index % 2 === 0 ? 'whoosh' : 'pop'
}

/** A stock clip the reel has not used yet (each plays once), or null when none is left. */
export function nextClip(props: ReelProps, state: PlanState): number | null {
  const n = props.broll?.length ?? 0
  let best: number | null = null
  let fewest = 1
  for (let i = 0; i < n; i += 1) {
    const used = state.bgTaken.filter((b) => b === i).length
    if (used < fewest) {
      best = i
      fewest = used
    }
  }
  return best
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
  avoid: readonly ScreenName[] = [],
): { show: ScreenName; props: Record<string, unknown> } {
  const { props } = ctx
  const text = textOf(props.words, chunk) || ('text' in scene ? scene.text : '')
  const sceneText = 'text' in scene ? scene.text : ''
  const visual = scene.kind === 'beat' ? scene.visual : undefined
  // A figure's second crop never follows another figure closely: that reads as the same screen twice.
  const figureNear = state.history.slice(-NO_REPEAT_WITHIN - 1).includes('FigureZoom')
  const images = usableImages(props.images, state.thumbUsed, props).filter(
    (i) =>
      (state.imageUses[i] ?? 0) < imageCap(props.images?.[i]) &&
      !(figureNear && props.images?.[i]?.kind === 'figure' && (state.imageUses[i] ?? 0) > 0),
  )
  const prev = state.history[state.history.length - 1]
  const cands: Candidate[] = []
  const add = (show: ScreenName, p: Record<string, unknown>, score: number) =>
    cands.push({ show, props: p, score })

  if (scene.kind === 'outro' && isLastInScene) {
    return { show: 'EndCard', props: {} }
  }

  const total = Math.max(1, props.durationSeconds)
  const imageBudget = usableImages(props.images, false, props).reduce(
    (n, i) => n + imageCap(props.images?.[i]),
    0,
  )
  const imageShots = Object.values(state.imageUses).reduce((a, b) => a + b, 0)
  const spacing = Math.max(IMAGE_EVERY_S, (total / Math.max(1, imageBudget)) * 0.9)
  const imageDue = images.length > 0 && atSeconds - state.lastImageAt >= spacing
  if (images.length > 0) {
    const idx = [...images].sort(
      (a, b) => (state.imageUses[a] ?? 0) - (state.imageUses[b] ?? 0),
    )[0]!
    const img = props.images![idx]!
    // A figure belongs to the beat that talks about it.
    const about =
      img.kind === 'figure' &&
      related(`${img.alt ?? ''} ${img.caption ?? ''}`, `${text} ${sceneText}`)
    const score =
      (imageDue ? 12 : 0.6 + (isFirstInScene && scene.kind === 'hook' ? 8 : 0)) + (about ? 6 : 0)
    for (const show of imageScreens(
      props.source,
      img,
      (state.imageUses[idx] ?? 0) > 0,
      state.thumbUsed,
    )) {
      add(show, { image: idx, variant: state.imageCursor }, score)
    }
  }

  if (props.demo && scene.kind !== 'hook' && scene.kind !== 'outro' && !state.uses.RepoDemo) {
    // The demo plays once: over the words that point at it when the narration has them.
    const cueNow = DEMO_CUE.test(text.split(/\s+/).slice(0, 3).join(' '))
    const cueLater = props.words.some((w) => w.start > atSeconds && DEMO_CUE.test(w.text))
    if (cueNow || !cueLater)
      add('RepoDemo', {}, cueNow ? 16 : isFirstInScene && sceneIndex === 1 ? 13 : 4)
  }

  const sourceScreen = SOURCE_SCREEN[props.source]
  const sourceImage = images[0]
  const sourceScore = scene.kind === 'hook' && isFirstInScene ? 5 : 1.8
  // A scripted quote shows in quote marks only when those words are really in the source.
  const quoted = visual?.type === 'quote' && isSourcedQuote(visual.text, props) ? visual : undefined
  const sceneQuote = quoted ? { text: quoted.text, attribution: quoted.attribution } : undefined
  if (SOURCE_SCREENS.has(sourceScreen)) {
    const used = state.sourceUsed[sourceScreen] ?? []
    const variant = nextVariant(sourceScreen, props, used, undefined, Boolean(sceneQuote))
    const found = variant === 'comment' ? commentFor(sourceScreen, props, sceneQuote) : null
    // A comment or post excerpt from the thread shows only over narration about the same thing.
    const comment =
      found && (sceneQuote || related(found.quote, `${text} ${sceneText}`)) ? found : null
    const quoteSeen = comment && state.keyTexts.has(comment.quote.toLowerCase())
    const figure = (props.images ?? []).findIndex((i) => i.kind === 'figure')
    const figureFree =
      figure >= 0 && (state.imageUses[figure] ?? 0) < imageCap(props.images?.[figure])
    if (
      variant &&
      (variant !== 'comment' || (comment && !quoteSeen)) &&
      (variant !== 'figure' || figureFree)
    ) {
      const extra = variant === 'figure' ? { image: figure } : (comment ?? {})
      add(sourceScreen, { focus: sceneIndex, variant, ...extra }, sourceScore)
    }
  } else if (sourceScreen === 'RepoPage' && repoCardSparse(props)) {
    // No description or counts to show: the repo's share card and the demo say more.
  } else if (!(sourceScreen === 'YouTubePlayer' && state.thumbUsed)) {
    if (!IMAGE_SCREENS.has(sourceScreen)) {
      add(sourceScreen, { focus: sceneIndex }, sourceScore)
    } else if (sourceImage !== undefined || (props.images?.length ?? 0) === 0) {
      const withImage = sourceImage === undefined ? {} : { image: sourceImage }
      add(sourceScreen, { focus: sceneIndex, ...withImage }, sourceScore)
    }
  }

  const fresh = (raw: string) => {
    const v = quantityValue(raw)
    return v !== null && !state.statValues.has(v) && !state.reserved.has(`value/${v}`)
  }
  const nums = spokenIn(sceneText, text).filter(
    (q) => fresh(q.raw) && q.label && !isSetupNumber(q.raw, q.label, sceneText),
  )
  const beatNums = quantitiesOf(sceneText)
  const visualSaid =
    visual?.type === 'stat' &&
    quantitiesOf(sceneText).some((q) => quantityValue(q.raw) === quantityValue(visual.value))
  const visualNow =
    visual?.type === 'stat' &&
    (!visualSaid || nums.some((q) => quantityValue(q.raw) === quantityValue(visual.value)))
  if (
    visual?.type === 'stat' &&
    visualNow &&
    fresh(visual.value) &&
    !isSetupNumber(visual.value, visual.label, sceneText)
  ) {
    add('StatSlam', { value: visual.value, label: visual.label }, isFirstInScene ? 9 : 3)
  } else if (nums[0]) {
    add('StatSlam', { value: nums[0].raw, label: nums[0].label }, 7)
  }
  if (beatNums.length >= 2) {
    const [a, b] = beatNums
    const secondNow = b && spokenIn(sceneText, text).some((q) => q.raw === b.raw)
    if (
      secondNow &&
      a &&
      b &&
      a.unit &&
      b.unit &&
      a.label &&
      b.label &&
      a.label !== b.label &&
      unitOf(a.raw) === unitOf(b.raw)
    ) {
      const seen = [a, b].some((q) => {
        const v = quantityValue(q.raw)
        return v !== null && (state.statValues.has(v) || state.reserved.has(`value/${v}`))
      })
      if (!seen) add('BarRace', barProps(a, b), 2.5)
    }
  }
  const pair = versusPair(text) ?? versusPair(sceneText)
  if (pair) add('Compare', { left: pair[0], right: pair[1] }, 4.5)

  const command = spokenCommand(sceneText)
  if (visual?.type === 'code') {
    const sh = shellLines(visual.code)
    const code = completeCode(visual.code)
    if (sh) add('Terminal', { lines: sh }, isFirstInScene ? 9 : 3)
    else if (code) add('CodeBlock', { code, language: visual.language }, isFirstInScene ? 9 : 3)
  } else if (command && new RegExp(`\\b${command.split(' ')[0]}\\b`, 'i').test(text)) {
    // The sentence says "Run dig +short TXT _dmarc.example.com": show that command typed out.
    add('Terminal', { lines: [command] }, 8)
  } else if (
    props.source === 'github' &&
    /\b(install|clone|run|command|cli|npx|npm|pip|terminal|setup)\b/i.test(text)
  ) {
    add('Terminal', { lines: [] }, 3.4)
  }
  if (visual?.type === 'title') {
    const subtitle = visual.subtitle && !carriesQuantity(visual.subtitle) ? visual.subtitle : ''
    const title = givenKeyPoint(props, visual.title, subtitle)
    if (title && !state.keyTexts.has(title.toLowerCase())) {
      add('KeyPoint', { text: title, sub: subtitle }, isFirstInScene ? 7 : 2.5)
    }
  }
  if (quoted && !state.keyTexts.has(quoted.text.toLowerCase())) {
    const quoteVariant =
      SOURCE_SCREENS.has(sourceScreen) &&
      (state.sourceUsed[sourceScreen] ?? []).length < 3 &&
      !(state.sourceUsed[sourceScreen] ?? []).includes('comment')
    const show: ScreenName =
      (props.source === 'hn' || props.source === 'reddit') && quoteVariant
        ? sourceScreen
        : 'KeyPoint'
    add(
      show,
      {
        quote: quoted.text,
        by: quoted.attribution,
        ...(show === 'KeyPoint'
          ? { text: quoted.text, sub: quoted.attribution }
          : { variant: 'comment' }),
      },
      isFirstInScene ? 8 : 3,
    )
  }
  const taken = new Set([...state.keyTexts, ...state.reservedTexts].map((t) => t.toLowerCase()))
  const [kp, kp2] = [
    ...keyPointFor(props, sceneText, text, state, undefined, 3),
    ...beatKeyPoints(props, scene).filter((t) => !taken.has(t.toLowerCase())),
  ]
    .map((t) => t.replace(/^(["'“‘(]*)(\p{Ll})/u, (_, q: string, c: string) => q + c.toUpperCase()))
    .filter((t) => showable(t, text))
  const bg = nextClip(props, state)
  if (kp) add('KeyPoint', { text: kp, sub: '' }, 1.6)
  if (kp2) add('KeyPoint', { text: kp2, sub: '' }, 1.5)
  // Footage under a claim or stat is assigned later (`assignBroll`), after every empty shot has its clip.
  if (bg !== null && !kp) add('KeyPoint', { text: '', sub: '', bg }, 1.2)

  let best: Candidate | undefined
  for (const c of cands) {
    let s = c.score
    {
      const otherLook = varietyKey(c.show, c.props) !== state.looks[state.looks.length - 1]
      if (c.show === prev) s -= c.show === 'KeyPoint' && otherLook ? 9 : 1000
      if (recentLook(state, c.show, c.props, prev)) s -= 150
    }
    if (avoid.includes(c.show)) s -= 500
    if (IMAGE_SCREENS.has(c.show) && !imageDue) {
      if (prev && IMAGE_SCREENS.has(prev)) s -= 3
      if (imageShots >= Math.ceil((atSeconds / total) * imageBudget)) s -= 4
    }
    const over = (state.uses[varietyKey(c.show, c.props)] ?? 0) - capFor(c.show) + 1
    if (over > 0) s -= 200 * over
    s -= 2.2 * state.history.slice(-5).filter((h) => h === c.show).length
    if (c.show === 'KeyPoint' && state.history.slice(-2).includes('KeyPoint')) s -= 1.5
    const id = identityOf(c.show, c.props)
    if (state.reserved.has(id)) s -= 600
    if (state.identities.includes(id)) {
      s -= state.identities[state.identities.length - 1] === id ? 2000 : 400
    }
    if (!best || s > best.score) best = { ...c, score: s }
  }
  const chosen = best ?? { show: 'KeyPoint' as ScreenName, props: { text: '', sub: '' }, score: 0 }
  return { show: chosen.show, props: chosen.props }
}

export function register(
  state: PlanState,
  show: ScreenName,
  atSeconds: number,
  kind?: ReelImage['kind'],
  image?: number,
  shotProps: Record<string, unknown> = {},
) {
  state.history.push(show)
  state.looks.push(varietyKey(show, shotProps))
  if (typeof shotProps.bg === 'number') state.bgTaken.push(shotProps.bg)
  const key = varietyKey(show, shotProps)
  state.uses[key] = (state.uses[key] ?? 0) + 1
  state.identities.push(identityOf(show, shotProps))
  release(state, identityOf(show, shotProps))
  if (SOURCE_SCREENS.has(show)) {
    const used = (state.sourceUsed[show] ??= [])
    used.push(variantOf(shotProps) ?? 'title')
    if (variantOf(shotProps) === 'figure' && typeof shotProps.image === 'number') {
      state.imageUses[shotProps.image] = (state.imageUses[shotProps.image] ?? 0) + 1
    }
  }
  if (show === 'KeyPoint' && typeof shotProps.text === 'string' && shotProps.text) {
    state.keyTexts.add(shotProps.text.toLowerCase())
  }
  if (typeof shotProps.quote === 'string' && shotProps.quote) {
    state.keyTexts.add(shotProps.quote.toLowerCase())
  }
  if (show === 'StatSlam') {
    const v = quantityValue(String(shotProps.value ?? ''))
    if (v !== null) {
      state.statValues.add(v)
      release(state, `value/${v}`)
    }
    // "94.7% ... was 80.9%": the number the label compares with is on screen too.
    const partner = /(?: · | )(?:was|from) (\S+)/.exec(String(shotProps.label ?? ''))?.[1]
    const pv = partner ? quantityValue(partner) : null
    if (pv !== null) state.statValues.add(pv)
  }
  if (show === 'KeyPoint' && typeof shotProps.text === 'string') {
    state.reservedTexts.delete(shotProps.text.toLowerCase())
  }
  if (IMAGE_SCREENS.has(show)) {
    state.lastImageAt = atSeconds
    state.imageCursor += 1
    if (image !== undefined) state.imageUses[image] = (state.imageUses[image] ?? 0) + 1
    if (kind === 'thumbnail' || show === 'YouTubePlayer') state.thumbUsed = true
  }
}

export const imageIndex = (shotProps: Record<string, unknown>): number =>
  typeof shotProps.image === 'number' ? shotProps.image : 0

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
    const scene = props.scenes[shot.sceneIndex]
    const [kp] = keyPointFor(props, scene && 'text' in scene ? scene.text : '', text, null)
    return { ...shot, show: 'KeyPoint' as ScreenName, props: { text: kp ?? '', sub: '' } }
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
    register(
      state,
      picked.show,
      at,
      imageOf(ctx.props, picked.props)?.kind,
      imageIndex(picked.props),
      picked.props,
    )
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
