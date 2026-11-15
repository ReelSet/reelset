import { MAX_HOOK_CHARS } from './hook-score'
import { slopPatterns } from './slop'
import { bare, findQuantities, isFunctionWord, isName } from './text-rules'

export type StyleLimits = {
  maxSentenceWords: number
  /** Flesch-Kincaid school grade of the whole narration. */
  maxGrade: number
  maxQuantitiesPerBeat: number
  minHookScore: number
  maxHookChars: number
}

export const STYLE_LIMITS: StyleLimits = {
  maxSentenceWords: 16,
  maxGrade: 9,
  maxQuantitiesPerBeat: 2,
  minHookScore: 50,
  maxHookChars: MAX_HOOK_CHARS,
}

export type Narration = { hook: string; beats: readonly { text: string }[]; outro: string }

const tokens = (text: string) => text.split(/\s+/).filter((t) => /[\p{L}\p{N}]/u.test(t))

export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])["')\]]*\s+(?=["'(\[]?[\p{Lu}\d])/u)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** A heard word's syllables. Names and numbers are capped: the ear takes them as one unit. */
export function syllables(word: string): number {
  const b = bare(word)
  if (!b) return 0
  if (/^\$?[\d.,]+%?$/.test(b)) return 2
  if (/^[A-Z0-9]{2,5}$/.test(b)) return Math.min(b.length, 3)
  const w = b.toLowerCase().replace(/[^a-z]/g, '')
  if (!w) return 1
  const groups = w
    .replace(/(?:[^laeiouy]es|[^dt]ed|[^laeiouy]e)$/, '')
    .replace(/^y/, '')
    .match(/[aeiouy]{1,2}/g)
  const count = Math.max(1, groups?.length ?? 1)
  return isName(word) ? Math.min(count, 2) : count
}

export function readingGrade(text: string): number {
  const words = tokens(text)
  const sents = sentences(text)
  if (words.length === 0 || sents.length === 0) return 0
  const syl = words.reduce((sum, w) => sum + syllables(w), 0)
  const grade = 0.39 * (words.length / sents.length) + 11.8 * (syl / words.length) - 15.59
  return Math.round(Math.max(0, grade) * 10) / 10
}

const content = (text: string): Set<string> =>
  new Set(
    tokens(text)
      .map((t) => bare(t).toLowerCase())
      .filter((w) => (w.length > 2 || /\d/.test(w)) && !isFunctionWord(w))
      .map((w) => (w.length > 4 ? w.replace(/(?:ing|ed|es|s)$/, '') : w)),
  )

const isConcrete = (text: string): boolean =>
  /\d/.test(text) ||
  tokens(text).some((t, i) => isName(t) || (i > 0 && /^\p{Lu}\p{Ll}{2,}/u.test(bare(t))))

/** What to rewrite so the narration is easy to follow by ear; empty when it is fine. */
export function styleIssues(script: Narration, limits: StyleLimits = STYLE_LIMITS): string[] {
  const issues: string[] = []
  const parts: [string, string][] = [
    ['hook', script.hook],
    ...script.beats.map((b, i): [string, string] => [`beat ${i + 1}`, b.text]),
    ['outro', script.outro],
  ]
  const all = parts.map(([, t]) => t).join(' ')

  if (script.hook.trim().length > limits.maxHookChars) {
    issues.push(
      `the hook is ${script.hook.trim().length} characters; keep every hook option to at most ${limits.maxHookChars} characters (about 3 seconds)`,
    )
  }
  const long = parts.flatMap(([where, text]) =>
    sentences(text)
      .filter((s) => tokens(s).length > limits.maxSentenceWords)
      .map((s) => `${where} has a ${tokens(s).length}-word sentence`),
  )
  if (long.length > 0) {
    issues.push(
      `${long.slice(0, 3).join(', ')}; split every sentence over ${limits.maxSentenceWords} words into two short ones`,
    )
  }
  const grade = readingGrade(all)
  if (grade > limits.maxGrade) {
    issues.push(
      `the narration reads at school grade ${grade}, above ${limits.maxGrade}; use shorter everyday words and swap or explain technical terms`,
    )
  }
  const crowded = script.beats
    .map((b, i) => ({ i, n: findQuantities(b.text).length }))
    .filter((b) => b.n > limits.maxQuantitiesPerBeat)
  if (crowded.length > 0) {
    issues.push(
      `beat ${crowded.map((b) => b.i + 1).join(', ')} packs in more than ${limits.maxQuantitiesPerBeat} numbers; keep the one that matters and drop the rest`,
    )
  }
  const abstract = script.beats.map((b) => !isConcrete(b.text))
  if (abstract.some((a, i) => a && abstract[i + 1] && abstract[i + 2])) {
    issues.push(
      'three beats in a row have no number and no name; put one concrete detail from the sources in each beat',
    )
  }
  const hookWords = content(script.hook)
  if (![...content(script.outro)].some((w) => hookWords.has(w))) {
    issues.push(
      'the outro shares no word with the hook; echo one key word or number from the hook in the last line so the replay lands',
    )
  }
  if (!/\byou(?:r|'re|’re|'ll|’ll)?\b/i.test(all)) {
    issues.push('the narration never speaks to the viewer; say "you" at least once')
  }
  issues.push(...slopPatterns(all))
  return issues
}
