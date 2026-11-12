import { bare, isFunctionWord } from './text-rules'

const NEGATION = new Set(['no', 'not', 'nobody', 'none', 'never', 'nothing', 'without', "don't"])
const stem = (w: string) =>
  w
    .toLowerCase()
    .replace(/(?:ments?|ings?|ed|es|s)$/, '')
    .slice(0, 6)

/** Stems of the content words of a text: "Nobody announced it" -> {announ}. */
export function ideaOf(text: string): Set<string> {
  const out = new Set<string>()
  for (const raw of text.split(/[\s/]+/)) {
    const w = bare(raw).toLowerCase()
    if (w.length < 3 || isFunctionWord(w) || NEGATION.has(w)) continue
    out.add(stem(w))
  }
  return out
}

/**
 * Two texts that say the same thing ("No official announcement" / "Nobody announced it."): most of
 * the shorter one's content words are in the longer one.
 */
export function sameIdea(a: string, b: string): boolean {
  const x = ideaOf(a)
  const y = ideaOf(b)
  const small = Math.min(x.size, y.size)
  if (small === 0) return false
  const shared = [...x].filter((w) => y.has(w)).length
  return shared >= 1 && shared / small >= 0.6
}

/** Two texts talk about the same thing: they share at least `min` content words. */
export function related(a: string, b: string, min = 2): boolean {
  const y = ideaOf(b)
  return [...ideaOf(a)].filter((w) => y.has(w)).length >= min
}
