import { sentences } from './extract'
import { findQuantities, nameSet, numberLabel, withMeasure, type Quantity } from './text-rules'

export { withMeasure }
import type { ReelProps, Word } from './types'

export type Spoken = Quantity & { label: string; sentence: string }

/** Quantities of a narration text with the label each sentence gives them. */
export function quantitiesOf(text: string): Spoken[] {
  return sentences(text).flatMap((sentence) =>
    findQuantities(sentence).map((q) => ({
      ...q,
      sentence,
      label: withMeasure(numberLabel(sentence, { start: q.index, end: q.end }), q.unit, text),
    })),
  )
}

const digitsOf = (raw: string) => /\d[\d,]*(?:\.\d+)?/.exec(raw)?.[0] ?? ''

/** Quantities of the scene that are spoken inside `chunk` (matched on the word tokens). */
export function spokenIn(sceneText: string, chunkText: string): Spoken[] {
  const tokens = chunkText.split(/\s+/).map((t) => digitsOf(t))
  return quantitiesOf(sceneText).filter((q) => tokens.includes(digitsOf(q.raw)))
}

export const wordsIn = (words: readonly Word[], start: number, end: number): string =>
  words
    .filter((w) => w.start >= start - 0.01 && w.start < end)
    .map((w) => w.text)
    .join(' ')

/** The sentence of `sceneText` that the chunk's words belong to (first content match), else ''. */
export function sentenceFor(sceneText: string, chunkText: string): string {
  const probe = chunkText
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase())
    .filter((w) => w.length > 3)
  const all = sentences(sceneText)
  return all.find((s) => probe.some((p) => s.toLowerCase().includes(p))) ?? all[0] ?? sceneText
}

const NAMES = new WeakMap<object, Set<string>>()

/** Names that may stand alone on a key point: words capitalised in the title, headline or repo. */
export function namesOf(props: Pick<ReelProps, 'title' | 'headline' | 'facts'>): Set<string> {
  const hit = NAMES.get(props)
  if (hit) return hit
  const r = props.facts?.repo
  const out = nameSet(props.title, r?.name, r?.owner, props.facts?.reddit?.subreddit)
  NAMES.set(props, out)
  return out
}

/** Every text the reel may quote a number from: narration, claims and the item's own facts. */
export function corpusOf(
  props: Pick<ReelProps, 'scenes' | 'claims' | 'facts' | 'title'>,
): string[] {
  const f = props.facts ?? {}
  const facts: string[] = []
  if (f.repo?.stars !== undefined) facts.push(`${f.repo.stars} stars`)
  if (f.repo?.forks !== undefined) facts.push(`${f.repo.forks} forks`)
  if (f.hn?.points !== undefined) facts.push(`${f.hn.points} points`)
  if (f.hn?.comments !== undefined) facts.push(`${f.hn.comments} comments`)
  if (f.reddit?.upvotes !== undefined) facts.push(`${f.reddit.upvotes} upvotes`)
  if (f.reddit?.comments !== undefined) facts.push(`${f.reddit.comments} comments`)
  if (f.youtube?.views !== undefined) facts.push(`${f.youtube.views} views`)
  if (f.paper?.upvotes !== undefined) facts.push(`${f.paper.upvotes} upvotes`)
  return [
    ...props.scenes.map((s) => ('text' in s ? s.text : '')),
    ...(props.claims ?? []),
    f.paper?.abstract ?? '',
    f.hn?.topComment ?? '',
    f.reddit?.text ?? '',
    f.reddit?.topComment ?? '',
    f.repo?.description ?? '',
    ...facts,
  ].filter(Boolean)
}

const tail = (words: string[], k: number) =>
  words
    .slice(words.length - k)
    .join(' ')
    .toLowerCase()

/**
 * Two numbers of one comparison as bars that say whose number each is: "94.7% average recovery"
 * and "MOPD average recovery" become bars "P^2-MOPD" / "MOPD" under the title "average recovery".
 */
export function barProps(
  a: Pick<Spoken, 'raw' | 'label' | 'sentence' | 'index'>,
  b: Pick<Spoken, 'raw' | 'label' | 'sentence' | 'index'>,
): { bars: { label: string; value: string }[]; title?: string } {
  const la = a.label.split(' · ')[0]!.split(' ')
  const lb = b.label.split(' · ')[0]!.split(' ')
  let k = 0
  while (k < Math.min(la.length, lb.length) && tail(la, k + 1) === tail(lb, k + 1)) k += 1
  const ownerA = la.slice(0, la.length - k).join(' ')
  const ownerB = lb.slice(0, lb.length - k).join(' ')
  if (k === 0 || !ownerA || !ownerB) {
    return {
      bars: [
        { label: a.label, value: a.raw },
        { label: b.label, value: b.raw },
      ],
    }
  }
  return {
    title: la.slice(la.length - k).join(' '),
    bars: [
      { label: ownerA, value: a.raw },
      { label: ownerB, value: b.raw },
    ],
  }
}
