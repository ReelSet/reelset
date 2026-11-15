// Client-safe form field names for the gate settings page: no imports, shared by the form and its parser.

export const GATE_FIELD = {
  mode: 'mode',
  threshold: 'threshold',
  weight: (signal: string) => `weight.${signal}`,
  ruleMode: (source: string) => `rule.${source}.mode`,
  ruleThreshold: (source: string) => `rule.${source}.threshold`,
  ruleMinItemScore: (source: string) => `rule.${source}.minItemScore`,
  instructions: 'instructions',
  model: 'model',
  effort: 'effort',
  exploreRatePercent: 'exploreRatePercent',
  exampleCount: 'exampleCount',
  maxCostUsdPerItem: 'maxCostUsdPerItem',
} as const

export const SOURCE_RULE_MODE_LABELS: Record<string, string> = {
  judge: 'Judge',
  always_reel: 'Always reel',
  always_source_only: 'Always source only',
}

/** Per-model cost marks for one judge call: under `skipBelowUsd` the call does not fit at all, under `fullEvidenceFromUsd` it fits with a shorter excerpt. */
export type CostMarks = { skipBelowUsd: number; fullEvidenceFromUsd: number }

/** Plain warning for a max cost per item that is too low for the chosen model, else null; unknown models and unusable caps say nothing. */
export function costCapWarning(marks: CostMarks | undefined, capUsd: number): string | null {
  if (!marks || !Number.isFinite(capUsd) || capUsd <= 0) return null
  if (capUsd < marks.skipBelowUsd) {
    return `One judgement on this model costs at least about $${marks.skipBelowUsd.toFixed(4)} with the saved instructions, which is more than this cap. The judge will be skipped and every item becomes a reel. Raise the cap or pick a cheaper model.`
  }
  if (capUsd < marks.fullEvidenceFromUsd) {
    return `This cap fits a judgement on this model only with less evidence: the judge will see a shorter excerpt of each source. About $${marks.fullEvidenceFromUsd.toFixed(4)} gives it the full excerpt.`
  }
  return null
}
