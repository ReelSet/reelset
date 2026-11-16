// Client-safe gate display types and copy: type-only core imports, so client components can use it.
import type { GateLabel, GateMode, GateVerdict } from '@reelset/core'

export type GateSignalView = { key: string; label: string; value: number | null; pct: number }
export type GateReasonOption = { key: string; label: string }

export type GateView = {
  decisionId: string
  itemId: string
  verdict: GateVerdict
  judgeVerdict: GateVerdict
  explored: boolean
  manual: boolean
  reviewQuestion: string
  disagreePrompt: string
  score: number | null
  threshold: number
  scoreMax: number
  signals: GateSignalView[]
  reasons: string[]
  rationale: string
  decidedBy: string
  rule: string | null
  mode: string
  applied: boolean
  appliedNote: string | null
  model: string | null
  promptVersion: string
  decidedAt: string
  label: GateLabel | null
  labelReason: string | null
  labelNote: string | null
  disagreeReasons: GateReasonOption[]
}

export const VERDICT_LABELS: Record<GateVerdict, string> = {
  reel: 'Reel',
  source_only: 'Source only',
}

export const DECIDER_LABELS: Record<string, string> = {
  model: 'Model',
  rule: 'Rule',
  explore: 'Explore',
  admin: 'Admin',
}

export const DECIDER_HINTS: Record<string, string> = {
  model: 'The judge scored the six signals',
  rule: 'A per-source rule settled it without a model call',
  explore: 'The judge said no, but it was made anyway as part of the explore sample',
  admin: 'An admin overrode the gate',
}

export const GATE_MODE_COPY: Record<GateMode, { label: string; sentence: string }> = {
  off: {
    label: 'Off',
    sentence: 'The gate is not running. Every item becomes a reel and nothing is recorded.',
  },
  shadow: {
    label: 'Shadow',
    sentence: 'Decisions are recorded, every item still becomes a reel.',
  },
  live: {
    label: 'Live',
    sentence:
      'Decisions are applied. Items judged source only get no script and no render, but stay searchable so Ask can cite them.',
  },
}

export const GATE_MIGRATION = '20261118000000_gate_decision'

export const GATE_TABLE_MISSING = `The database migration ${GATE_MIGRATION} has not been applied to this database, so there is no gate data to show. (If it has been applied, the query failed; see the server logs.)`

export const GATE_MIGRATION_FIRST = `Apply the migration ${GATE_MIGRATION} before deploying the ingest worker. The code needs the "source_only" item status to exist in the database in every mode, including Shadow and Off.`

export const MANUAL_TAG = 'Manual'
export const MANUAL_HINT =
  'An admin asked the gate to judge this item on demand. It is for analysis only and changed nothing about the item or its reel.'
export const JUDGE_NOW_NOTE =
  'For analysis only: it records what the gate thinks of this item today and changes nothing about the item or its reel. It can take up to a minute and costs one model call.'

export const TRIGGER_LABELS: Record<string, string> = { auto: 'Automatic', manual: 'Manual' }

export const EXPLORED_TAG = 'Explored: made anyway'
export const EXPLORED_HINT =
  'The judge scored this below the threshold and said source only. It was made into a reel anyway, as part of the explore sample, to test whether that no was wrong.'

export function fmtGateScore(score: number | null): string {
  return score === null ? '-' : String(Math.round(score))
}
