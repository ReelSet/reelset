import { isFunctionWord } from './text-rules'

const stem = (w: string) => w.replace(/(?:ing|ed|es|s)$/, '')

const tokens = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s.]/gu, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^\.+|\.+$/g, ''))
    .filter((w) => w.length > 0)

/** Share of a key point's content words that the captions on screen already say. */
export function captionOverlap(text: string, spoken: string): number {
  const mine = tokens(text).filter((w) => !isFunctionWord(w))
  if (mine.length === 0) return 0
  const said = new Set(tokens(spoken).map(stem))
  return mine.filter((w) => said.has(stem(w))).length / mine.length
}

/** A key point that is a near-verbatim copy of the words captioned under it adds nothing. */
export const ECHO_SHARE = 0.75

export function echoesCaption(text: string, spoken: string): boolean {
  const mine = tokens(text).filter((w) => !isFunctionWord(w))
  return mine.length >= 2 && captionOverlap(text, spoken) >= ECHO_SHARE
}

/** Sentence case: opens on a capital, a digit or a quote, never a lowercase fragment. */
export const isSentenceCase = (text: string): boolean => {
  const first = text.trim().replace(/^["'“‘(]+/, '')[0]
  return first !== undefined && /[\p{Lu}\p{N}]/u.test(first)
}

/** The only key points a reel shows: a statement in sentence case that the captions do not already say. */
export const showable = (text: string, spoken: string): boolean =>
  text.trim() !== '' && isSentenceCase(text) && !echoesCaption(text, spoken)
