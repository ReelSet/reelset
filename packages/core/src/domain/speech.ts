export const AURA_CHARS_PER_SECOND = 14.2
// About 77 s at this rate. Measured production narration runs 12.2 to 17 chars/s, so the slowest
// voice lands near 90 s, under the renderer's 100 s video cap with the end card.
export const MAX_SPOKEN_CHARS = 1100
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
