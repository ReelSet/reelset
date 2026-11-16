import {
  GATE_SCORE_MAX,
  correctGateVerdict,
  gateVerdict,
  type GateLabel,
  type GateVerdict,
} from '@reelset/core'

export const DRY_RUN_SAMPLE = 200
export const SUGGEST_SAMPLE = 500
export const SUGGEST_MIN_LABELS = 20
export const SUGGEST_MIN_PER_SIDE = 3

/** A stored model judgement with its score: enough to re-cut it against another threshold without calling the model. Callers pass rows of one prompt version only, since versions score on different scales. */
export type JudgedDecision = {
  score: number
  threshold: number
  verdict: GateVerdict
  label: GateLabel | null
  source: string
}

export type GateTuning = {
  threshold: number
  sourceThresholds?: Partial<Record<string, number>>
}

export type DryRunResult = {
  sample: number
  reelToSourceOnly: number
  sourceOnlyToReel: number
  reelsBefore: number
  reelsAfter: number
  labelled: number
  matchedBefore: number
  matchedAfter: number
}

// The judge's own call, which differs from the stored verdict on explore rows.
function judgedBefore(decision: JudgedDecision): GateVerdict {
  return gateVerdict(decision.score, decision.threshold)
}

function judgedAfter(decision: JudgedDecision, tuning: GateTuning): GateVerdict {
  const threshold = tuning.sourceThresholds?.[decision.source] ?? tuning.threshold
  return gateVerdict(decision.score, threshold)
}

function correctVerdict(decision: JudgedDecision): GateVerdict | null {
  return decision.label ? correctGateVerdict(decision.verdict, decision.label) : null
}

/** Re-cuts stored scores against a proposed threshold: what flips, the new reel share, and how the change scores against admin labels. */
export function dryRunGate(decisions: readonly JudgedDecision[], tuning: GateTuning): DryRunResult {
  const result: DryRunResult = {
    sample: 0,
    reelToSourceOnly: 0,
    sourceOnlyToReel: 0,
    reelsBefore: 0,
    reelsAfter: 0,
    labelled: 0,
    matchedBefore: 0,
    matchedAfter: 0,
  }
  for (const decision of decisions) {
    const before = judgedBefore(decision)
    const after = judgedAfter(decision, tuning)
    result.sample += 1
    if (before === 'reel') result.reelsBefore += 1
    if (after === 'reel') result.reelsAfter += 1
    if (before === 'reel' && after === 'source_only') result.reelToSourceOnly += 1
    if (before === 'source_only' && after === 'reel') result.sourceOnlyToReel += 1
    const correct = correctVerdict(decision)
    if (!correct) continue
    result.labelled += 1
    if (before === correct) result.matchedBefore += 1
    if (after === correct) result.matchedAfter += 1
  }
  return result
}

export type ThresholdSuggestion = {
  threshold: number
  matches: number
  currentMatches: number
  sample: number
}

/** The whole-number threshold that matches the most admin labels on the stored scores (ties go to the one nearest the current threshold); null until there are enough labels on both sides. */
export function suggestThreshold(
  decisions: readonly JudgedDecision[],
  currentThreshold: number,
): ThresholdSuggestion | null {
  const labelled = decisions.flatMap((decision) => {
    const correct = correctVerdict(decision)
    return correct ? [{ score: decision.score, correct }] : []
  })
  const shouldBeReel = labelled.filter((entry) => entry.correct === 'reel').length
  const smallerSide = Math.min(shouldBeReel, labelled.length - shouldBeReel)
  if (labelled.length < SUGGEST_MIN_LABELS || smallerSide < SUGGEST_MIN_PER_SIDE) return null

  const matchesAt = (threshold: number) =>
    labelled.filter((entry) => gateVerdict(entry.score, threshold) === entry.correct).length
  let best = { threshold: currentThreshold, matches: matchesAt(currentThreshold) }
  const currentMatches = best.matches
  for (let threshold = 0; threshold <= GATE_SCORE_MAX; threshold++) {
    const matches = matchesAt(threshold)
    const closer =
      Math.abs(threshold - currentThreshold) < Math.abs(best.threshold - currentThreshold)
    if (matches > best.matches || (matches === best.matches && closer)) {
      best = { threshold, matches }
    }
  }
  return { ...best, currentMatches, sample: labelled.length }
}
