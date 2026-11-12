import type { Word } from './types'

export const norm = (w: string) => w.toLowerCase().replace(/[^a-z0-9]/g, '')

export function parseCue(cue: string): { word: string; nth: number } {
  const hash = cue.lastIndexOf('#')
  const n = hash > 0 ? Number(cue.slice(hash + 1)) : 1
  const word = hash > 0 && Number.isInteger(n) && n >= 1 ? cue.slice(0, hash) : cue
  return { word: word.trim(), nth: hash > 0 && Number.isInteger(n) && n >= 1 ? n : 1 }
}

function matches(words: readonly Word[], target: string[], loose: boolean): number[] {
  const hits: number[] = []
  for (let i = 0; i + target.length <= words.length; i += 1) {
    const ok = target.every((t, k) => {
      const w = norm(words[i + k]?.text ?? '')
      if (w === t) return true
      return loose && t.length >= 4 && w.length >= 4 && (w.startsWith(t) || t.startsWith(w))
    })
    if (ok) hits.push(i)
  }
  return hits
}

/**
 * Time in seconds of a spoken-word cue ('word', 'word#2', or a short phrase), searched only inside
 * [from, to). Exact normalized match first, then a prefix match. Returns null when absent.
 */
export function cueTime(
  cue: string,
  words: readonly Word[],
  window?: { from?: number; to?: number },
): number | null {
  const { word, nth } = parseCue(cue)
  const target = word.split(/\s+/).map(norm).filter(Boolean)
  if (target.length === 0) return null
  const scoped = words.filter(
    (w) => w.start >= (window?.from ?? -Infinity) - 0.01 && w.start < (window?.to ?? Infinity),
  )
  let hits = matches(scoped, target, false)
  if (hits.length === 0) hits = matches(scoped, target, true)
  const hit = hits[nth - 1]
  return hit === undefined ? null : (scoped[hit]?.start ?? null)
}
