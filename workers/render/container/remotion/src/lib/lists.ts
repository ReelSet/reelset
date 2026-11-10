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
  const raw = sentence.replace(/[.!?]+$/, '').split(/,\s*/)
  // "Flux, Qwen and SDXL" (no serial comma): the last segment holds two items.
  const segs = raw.flatMap((seg, k) => {
    const m = k > 0 ? /^(.+?)\s+((?:and|or)\s+.+)$/i.exec(seg) : null
    if (!m?.[1] || !m[2] || /^(?:and|or)\s/i.test(seg)) return [seg]
    const left = tokens(m[1])
    // Only names ("Qwen", "msn.com"): lower-case words here are usually verbs ("fixes and explores").
    const nouns = left.every((w) => isItemWord(w) && !isVerbForm(w) && /^[A-Z0-9]|\./.test(w))
    return left.length > 0 && left.length <= 3 && nouns ? [m[1], m[2]] : [seg]
  })
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
    // A bare number is a quantity of the next item ("94 pictures"), not a list entry.
    if (items.some((it) => !/\p{L}/u.test(it))) continue
    // The words that introduce the items ("image models like"), never a whole clause.
    const kicker = claimTokensOf(first.head).slice(-4).join(' ')
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

export type ListPiece = { from: number; to: number; first: number; last: number }

/**
 * Cards for a list said over `[start, end)` with items starting at `times`, none held over 4 s:
 * one card; for three items or fewer one card over the last 4 s (items said before it start lit);
 * else two cards that each show their own items, so the cut is a new card, not the same again.
 */
export function listPieces(
  start: number,
  end: number,
  times: readonly number[],
): ListPiece[] | null {
  const n = times.length
  if (end - start < 1.2) return null
  if (end - start <= MAX_HOLD_S) return [{ from: start, to: end, first: 0, last: n }]
  if (n <= 3 || end - times[0]! <= MAX_HOLD_S - 0.1)
    return [{ from: end - MAX_HOLD_S, to: end, first: 0, last: n }]
  const mid = Math.min(n - 2, Math.max(1, Math.ceil(n / 2)))
  if (mid < 1) return null
  const split = times[mid]! - 0.1
  const from = Math.max(start, split - MAX_HOLD_S)
  if (end - split > MAX_HOLD_S || split - from < 1 || times[0]! < from) return null
  return [
    { from, to: split, first: 0, last: mid },
    { from: split, to: end, first: mid, last: n },
  ]
}

/**
 * Spoken lists become list cards that fill in as each item is said (same layout for every item,
 * cut on the voice), replacing whatever was planned over them; see `listPieces` for long lists.
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
      const end = at.end + 0.25
      const pieces = listPieces(
        Math.max(lead?.start ?? at.times[0]!, at.times[0]! - 1.2),
        end,
        at.times,
      )
      if (!pieces) continue
      const made: TimedShot[] = pieces.map((p, k) => {
        const from = Math.round(p.from * fps)
        return {
          from,
          frames: Math.round(p.to * fps) - from,
          show: 'KeyPoint',
          props: {
            items: list.items.slice(p.first, p.last),
            kicker: list.kicker,
            times: at.times
              .slice(p.first, p.last)
              .map((t) => Math.max(0, Math.round((t - p.from) * 100) / 100)),
            text: '',
            sub: '',
            // The second card of a long list uses the other layout: a cut, not the same card again.
            ...(k > 0 ? { layout: 1 } : {}),
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

/**
 * Type size for a list card: as large as fits (at most 120 px), items may wrap between words but a
 * word never breaks or crosses the frame, and the rows fit `height`.
 */
export function listSize(items: readonly string[], width: number, height: number): number {
  const charW = 0.64
  const words = items.flatMap((i) => i.split(/\s+/))
  const widest = Math.max(1, ...words.map((w) => w.length))
  for (let size = 120; size > 40; size -= 2) {
    if (widest * charW * size > width) continue
    const perLine = Math.max(1, Math.floor(width / (size * charW)))
    const lines = items.reduce((n, item) => {
      let rows = 1
      let used = 0
      for (const w of item.split(/\s+/)) {
        const need = w.length + (used > 0 ? 1 : 0)
        if (used + need > perLine && used > 0) {
          rows += 1
          used = w.length
        } else used += need
      }
      return n + rows
    }, 0)
    if (lines * size * 1.05 + items.length * size * 0.45 <= height) return size
  }
  return 40
}
