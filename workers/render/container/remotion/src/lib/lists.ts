import { sentences } from './extract'
import { MAX_HOLD_S } from './planner'
import { bare, claimTokensOf, isFunctionWord, isVerbForm } from './text-rules'
import type { ReelProps, TimedShot, Word } from './types'

export type SpokenList = { kicker: string; items: string[] }

const tokens = (s: string) => s.split(/\s+/).filter(Boolean)
const isItemWord = (w: string) => !isFunctionWord(w) && !isVerbForm(w) && bare(w).length > 0
const nameLike = (item: string) => /[.@]/.test(item) || /^\p{Lu}/u.test(item)

/** Trailing content words of a clause: "This affects mail to outlook.com" -> "outlook.com". */
function tailItem(seg: string, max: number): { item: string; head: string } | null {
  const t = tokens(seg)
  let k = t.length
  while (k > 0 && t.length - k < max && isItemWord(t[k - 1]!)) k -= 1
  if (k === t.length) return null
  return { item: t.slice(k).map(bare).join(' '), head: t.slice(0, k).join(' ') }
}

/** Leading content words after "and"/"or": "or msn.com addresses if ..." -> "msn.com addresses". */
function headItem(seg: string, max: number): string | null {
  const t = tokens(seg)
  if (!/^(?:and|or)$/i.test(t[0] ?? '')) return null
  const out: string[] = []
  for (const w of t.slice(1)) {
    if (!isItemWord(w) || out.length >= max) break
    out.push(bare(w))
  }
  return out.length > 0 ? out.join(' ') : null
}

/**
 * A spoken list of three or more short items ("outlook.com, hotmail.com, live.com, or msn.com";
 * "spoofing, phishing, and business email compromise") with the words that introduce it.
 */
export function listIn(sentence: string): SpokenList | null {
  const segs = sentence.replace(/[.!?]+$/, '').split(/,\s*/)
  for (let i = 0; i + 2 < segs.length; i += 1) {
    const middle: string[] = []
    let j = i + 1
    while (j < segs.length && !/^(?:and|or)\s/i.test(segs[j]!)) {
      const t = tokens(segs[j]!)
      if (t.length === 0 || t.length > 3 || !t.every(isItemWord)) break
      middle.push(t.map(bare).join(' '))
      j += 1
    }
    if (middle.length === 0 || j >= segs.length) continue
    const short = middle.every((m) => !m.includes(' '))
    let last = headItem(segs[j]!, 3)
    const first = tailItem(segs[i]!, short ? 1 : 3)
    if (!last || !first) continue
    if (short && nameLike(middle[0]!)) last = last.split(' ')[0]!
    const items = [first.item, ...middle, last]
    if (items.length < 3) continue
    const kicker = claimTokensOf(first.head).join(' ')
    return { kicker: kicker.charAt(0).toUpperCase() + kicker.slice(1), items }
  }
  return null
}

const norm = (w: string) => bare(w).toLowerCase()

/** Start time of each item's first word, in order, within `[from, to)`; null if any is missing. */
export function itemTimes(
  words: readonly Word[],
  items: readonly string[],
  from: number,
  to: number,
): { times: number[]; end: number } | null {
  const inside = words.filter((w) => w.start >= from - 0.01 && w.start < to)
  const times: number[] = []
  let k = 0
  let end = 0
  for (const item of items) {
    const parts = item.split(' ').map((p) => p.toLowerCase())
    while (k < inside.length && norm(inside[k]!.text) !== parts[0]) k += 1
    if (k >= inside.length) return null
    times.push(inside[k]!.start)
    k += parts.length
    end = inside[Math.min(k, inside.length) - 1]!.end
  }
  return { times, end }
}

/**
 * Spoken lists become one list card that fills in as each item is said (same layout for every
 * item, cut on the voice), replacing whatever was planned over them. Longer than 4 s, it splits at
 * an item into two cards; the second starts with the items already said.
 */
export function revealLists(shots: TimedShot[], props: ReelProps, fps: number): TimedShot[] {
  let out = [...shots]
  props.scenes.forEach((scene, sceneIndex) => {
    if (!('text' in scene)) return
    for (const sentence of sentences(scene.text)) {
      const list = listIn(sentence)
      if (!list) continue
      const at = itemTimes(props.words, list.items, scene.start, scene.end)
      if (!at) continue
      const kickerWords = tokens(list.kicker).length
      const firstIdx = props.words.findIndex((w) => w.start >= at.times[0]! - 0.01)
      const lead = props.words[Math.max(0, firstIdx - Math.min(kickerWords, 3))]
      const start = Math.max(lead?.start ?? at.times[0]!, at.times[0]! - 1.2)
      const end = at.end + 0.25
      if (end - start < 1.2) continue
      const pieces: { from: number; to: number; first: number }[] = []
      if (end - start <= MAX_HOLD_S) pieces.push({ from: start, to: end, first: 0 })
      else {
        const mid = at.times.findIndex((t) => t - start > (end - start) / 2)
        const split = mid > 0 ? at.times[mid]! : start + (end - start) / 2
        if (split - start > MAX_HOLD_S || end - split > MAX_HOLD_S) continue
        pieces.push({ from: start, to: split, first: 0 }, { from: split, to: end, first: mid })
      }
      const made: TimedShot[] = pieces.map((p) => {
        const from = Math.round(p.from * fps)
        return {
          from,
          frames: Math.round(p.to * fps) - from,
          show: 'KeyPoint',
          props: {
            items: list.items,
            kicker: list.kicker,
            times: at.times.map((t) => Math.round((t - p.from) * 100) / 100),
            text: '',
            sub: '',
          },
          sceneIndex,
          origin: 'planned',
          sfx: 'pop',
        }
      })
      out = spliceShots(out, made, fps)
    }
  })
  return out
}

/** Puts `made` (contiguous) into the timeline; neighbours are trimmed, covered shots removed. */
export function spliceShots(shots: TimedShot[], made: TimedShot[], fps: number): TimedShot[] {
  const S = made[0]!.from
  const last = made[made.length - 1]!
  const E = last.from + last.frames
  const minFrames = Math.round(0.5 * fps)
  const out: TimedShot[] = []
  for (const s of shots) {
    const end = s.from + s.frames
    if (end <= S || s.from >= E) {
      out.push(s)
      continue
    }
    if (s.from < S && S - s.from >= minFrames) out.push({ ...s, frames: S - s.from })
    if (end > E && end - E >= minFrames) out.push({ ...s, from: E, frames: end - E })
  }
  const merged = [...out, ...made].sort((a, b) => a.from - b.from)
  return merged.map((s, i) => {
    const next = merged[i + 1]
    return next ? { ...s, frames: next.from - s.from } : s
  })
}
