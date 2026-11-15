import {
  GATE_SCORE_MAX,
  correctGateVerdict,
  gateScore,
  gateVerdict,
  type GateLabel,
  type GateSignals,
  type GateVerdict,
  type GateWeights,
} from '@reelset/core'

export const DRY_RUN_SAMPLE = 200
export const SUGGEST_SAMPLE = 500
export const SUGGEST_MIN_LABELS = 20
export const SUGGEST_MIN_PER_SIDE = 3

/** A stored model judgement: enough to re-score it without calling the model again. */
export type JudgedDecision = {
  signals: GateSignals
  score: number | null
  threshold: number
  verdict: GateVerdict
  label: GateLabel | null
  source: string
}

export type GateTuning = {
  threshold: number
  weights: Partial<GateWeights>
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

const hasSignals = (decision: JudgedDecision) => Object.keys(decision.signals).length > 0

// The judge's own call, which differs from the stored verdict on explore rows.
function judgedBefore(decision: JudgedDecision): GateVerdict {
  return decision.score === null
    ? decision.verdict
    : gateVerdict(decision.score, decision.threshold)
}

function judgedAfter(decision: JudgedDecision, tuning: GateTuning): GateVerdict {
  const threshold = tuning.sourceThresholds?.[decision.source] ?? tuning.threshold
  return gateVerdict(gateScore(decision.signals, tuning.weights), threshold)
}

function correctVerdict(decision: JudgedDecision): GateVerdict | null {
  return decision.label ? correctGateVerdict(decision.verdict, decision.label) : null
}

/** Re-scores stored judgements under a proposed threshold and weights; decisions without signals are left out. */
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
  for (const decision of decisions.filter(hasSignals)) {
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

/** The whole-number threshold that matches the most admin labels under these weights (ties go to the one nearest the current threshold); null until there are enough labels on both sides. */
export function suggestThreshold(
  decisions: readonly JudgedDecision[],
  weights: Partial<GateWeights>,
  currentThreshold: number,
): ThresholdSuggestion | null {
  const labelled = decisions.filter(hasSignals).flatMap((decision) => {
    const correct = correctVerdict(decision)
    return correct ? [{ score: gateScore(decision.signals, weights), correct }] : []
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
