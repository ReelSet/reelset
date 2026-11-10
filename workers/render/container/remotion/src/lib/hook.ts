import { usableImages } from './planner'
import { headlineFrom } from './extract'
import { quantitiesOf } from './numbers'
import { isQuantityValue, quantityValue } from './text-rules'
import { mentions, valueOf } from './labels'
import type { ReelImage, ReelProps, TimedShot } from './types'

/** Social proof is shown big when it is big enough to impress (see `HOOK_PROOF_MIN` for opening on it). */
export const PROOF_MIN: Record<string, number> = { hn: 150, reddit: 500, github: 1000, papers: 50 }
/** Popularity is not the story: a count opens the reel only when it is five times the bar above, else the headline does. */
export const HOOK_PROOF_MIN: Record<string, number> = {
  hn: 750,
  reddit: 2500,
  github: 5000,
  papers: 250,
}

type Choice = { show: TimedShot['show']; props: Record<string, unknown> }

const aspect = (img: ReelImage): number | null =>
  img.width && img.height ? img.width / img.height : null

/**
 * An image that works full-bleed under the headline: a photo or a portrait / square picture. A wide
 * share card, paper thumbnail or figure carries its text to the edges, so cropping it to the frame
 * would cut words and shrinking it leaves a small picture in a blurred surround.
 */
export function bleedsWell(img: ReelImage, source: ReelProps['source']): boolean {
  if (img.kind === 'figure' || img.kind === 'avatar') return false
  if (img.kind === 'thumbnail' && source === 'youtube') return true
  const a = aspect(img)
  return a !== null && a <= 1.3
}

/** A number said in the hook that no later scene repeats: the hook's own big statistic. */
export function hookStat(props: ReelProps): { value: string; label: string } | null {
  const hook = props.scenes[0]
  if (!hook || hook.kind !== 'hook') return null
  const later = props.scenes.slice(1).flatMap((s) => quantitiesOf('text' in s ? s.text : ''))
  const seen = new Set(later.map((q) => quantityValue(q.raw)))
  return (
    quantitiesOf(hook.text)
      .filter((q) => q.label && isQuantityValue(q.raw) && !seen.has(quantityValue(q.raw)))
      .map((q) => ({ value: q.raw, label: q.label }))[0] ?? null
  )
}

/** A real count from the item facts, when it is big enough to stop a scroll. */
export function hookProof(props: ReelProps): { value: string; label: string } | null {
  const f = props.facts ?? {}
  const pick: [number | undefined, string, string][] = [
    [f.hn?.points, 'hn', 'points on Hacker News'],
    [f.reddit?.upvotes, 'reddit', 'upvotes on Reddit'],
    [f.repo?.stars, 'github', 'GitHub stars'],
    [f.paper?.upvotes, 'papers', 'upvotes on Hugging Face'],
  ]
  for (const [n, source, label] of pick) {
    if (
      props.source === source &&
      typeof n === 'number' &&
      n >= (HOOK_PROOF_MIN[source] ?? Infinity)
    )
      return { value: n.toLocaleString('en-US'), label }
  }
  return null
}

/** The script's headline (<= 7 words), else the hook's first clause. */
export function hookHeadline(props: ReelProps): string {
  const given = props.headline?.trim()
  if (given) return given.split(/\s+/).slice(0, 7).join(' ')
  const hook = props.scenes[0]
  return headlineFrom(hook && 'text' in hook ? hook.text : props.title)
}

/**
 * What the reel opens on, strongest first: the README demo playing, the hook's own big number, a
 * full-bleed real image, a big social-proof count, else the headline set huge. Always something.
 */
export function hookChoice(props: ReelProps): Choice {
  if (props.demo) return { show: 'RepoDemo', props: {} }
  const stat = hookStat(props)
  if (stat) return { show: 'StatSlam', props: { value: stat.value, label: stat.label } }
  const images = usableImages(props.images, false, props)
  const idx = images.find((i) => bleedsWell(props.images![i]!, props.source))
  if (idx !== undefined) return { show: 'ImageFull', props: { image: idx, bleed: true } }
  const proof = hookProof(props)
  if (proof)
    return { show: 'StatSlam', props: { value: proof.value, label: proof.label, proof: true } }
  // Nothing real to open on: the headline itself, huge, over the story's own image when it has one.
  const back = images.find((i) => props.images![i]!.kind !== 'figure')
  return {
    show: 'KeyPoint',
    props: {
      text: hookHeadline(props),
      sub: '',
      hook: true,
      ...(back === undefined ? {} : { bgImage: back }),
    },
  }
}

/** The first shot already stops the scroll: a stat, the demo, or a full-bleed image. */
export function isScrollStopper(shot: Pick<TimedShot, 'show' | 'props'>): boolean {
  if (shot.show === 'StatSlam' || shot.show === 'RepoDemo') return true
  if (shot.show === 'ImageFull') return shot.props.bleed === true
  return shot.show === 'KeyPoint' && shot.props.hook === true
}

/** Replaces a first shot that does not stop the scroll (a thumbnail in a blurred surround, a source card). */
export function applyHook(shots: TimedShot[], props: ReelProps): TimedShot[] {
  const first = shots[0]
  if (!first || props.scenes[0]?.kind !== 'hook') return shots
  if (isScrollStopper(first)) return withoutHookRepeats(shots)
  const choice = hookChoice(props)
  const sfx: TimedShot['sfx'] = 'hit'
  return withoutHookRepeats([{ ...first, ...choice, origin: 'planned', sfx }, ...shots.slice(1)])
}

/** Numbers the hook stat already shows (its value and the "was X" it compares with). */
function shownByHook(shot: TimedShot): number[] {
  if (shot.show !== 'StatSlam') return []
  const label = typeof shot.props.label === 'string' ? shot.props.label : ''
  const partner = /(?: · | )(?:was|from) (\S+)/.exec(label)?.[1]
  return [valueOf(String(shot.props.value ?? '')), partner ? valueOf(partner) : null].filter(
    (v): v is number => v !== null,
  )
}

/** A later big stat never repeats a number the opening shot already put on screen. */
export function withoutHookRepeats(shots: TimedShot[]): TimedShot[] {
  const seen = shownByHook(shots[0]!)
  if (seen.length === 0) return shots
  return shots.map((s, i) =>
    i > 0 &&
    s.show === 'StatSlam' &&
    mentions(String(s.props.value ?? '')).some((m) => seen.includes(m.value))
      ? {
          ...s,
          show: 'KeyPoint' as const,
          props: { text: '', sub: '' },
          origin: 'planned' as const,
        }
      : s,
  )
}

/** The opening stat already shows the number the headline slab would lead with (a stat and a slab saying 94.7% twice is noise). */
export function statSaysHeadline(
  shot: Pick<TimedShot, 'show' | 'props'> | undefined,
  headline: string,
): boolean {
  if (shot?.show !== 'StatSlam') return false
  const value = valueOf(String(shot.props.value ?? ''))
  return value !== null && mentions(headline).some((m) => m.value === value)
}
