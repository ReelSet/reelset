export const AURA_CHARS_PER_SECOND = 14.2
export const MAX_SPOKEN_CHARS = 760
const FREE_DIGITS = 3
const EXTRA_DIGIT_WEIGHT = 4

/** Text length weighted by how long Aura takes to say it: digits past the third in a run are read one by one. */
export function spokenChars(text: string): number {
  const digitRuns = text.match(/\d+/g) ?? []
  const extra = digitRuns.reduce(
    (sum, run) => sum + Math.max(0, run.length - FREE_DIGITS) * (EXTRA_DIGIT_WEIGHT - 1),
    0,
  )
  return text.length + extra
}

export function estimateSpeechSeconds(text: string): number {
  return spokenChars(text) / AURA_CHARS_PER_SECOND
}
