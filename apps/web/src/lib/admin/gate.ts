import {
  GATE_DECIDERS,
  GATE_LABELS,
  GATE_LABEL_NOTE_MAX_CHARS,
  GATE_LABEL_REASONS,
  GATE_SCORE_MAX,
  GATE_SIGNALS,
  GATE_SIGNAL_MAX,
  GATE_TRIGGERS,
  GATE_VERDICTS,
  SOURCES,
  gateLabelReasonSchema,
  gateVerdictSchema,
  judgeVerdict,
  oppositeGateVerdict,
  parseGateSignals,
  type GateDecidedBy,
  type GateDecisionRow,
  type GateLabelReason,
  type GateTrigger,
  type GateVerdict,
  type Source,
} from '@reelset/core'
import { z } from 'zod'
import type { GateReasonOption, GateView } from './gate-view'
import type { SearchParams, SortState } from './sort'

export const GATE_PAGE_SIZE = 30
export const GATE_BULK_LIMIT = 200
export const GATE_SEARCH_MAX_CHARS = 80

export const GATE_REVIEW_FILTERS = ['pending', 'agreed', 'disagreed', 'all'] as const
export type GateReviewFilter = (typeof GATE_REVIEW_FILTERS)[number]
export const DEFAULT_GATE_REVIEW: GateReviewFilter = 'pending'

export const GATE_REVIEW_LABELS: Record<GateReviewFilter, string> = {
  pending: 'Needs review',
  agreed: 'Agreed',
  disagreed: 'Disagreed',
  all: 'All',
}

export const GATE_RANGE_DAYS = [1, 7, 30] as const
export type GateRangeDays = (typeof GATE_RANGE_DAYS)[number]
export const DEFAULT_GATE_RANGE: GateRangeDays = 7

export const GATE_SORT_KEYS = ['decided', 'score'] as const
export type GateSortKey = (typeof GATE_SORT_KEYS)[number]
export const DEFAULT_GATE_SORT: SortState<GateSortKey> = { key: 'decided', dir: 'desc' }

export type GateFilters = {
  review: GateReviewFilter
  verdict: GateVerdict | null
  decidedBy: GateDecidedBy | null
  source: Source | null
  trigger: GateTrigger | null
  q: string | null
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)

function oneOf<T extends string>(allowed: readonly T[], raw: string | undefined): T | null {
  return allowed.find((value) => value === raw) ?? null
}

export function parseGateFilters(sp: SearchParams): GateFilters {
  return {
    review: oneOf(GATE_REVIEW_FILTERS, first(sp.review)) ?? DEFAULT_GATE_REVIEW,
    verdict: oneOf(GATE_VERDICTS, first(sp.verdict)),
    decidedBy: oneOf(GATE_DECIDERS, first(sp.by)),
    source: oneOf(SOURCES, first(sp.source)),
    trigger: oneOf(GATE_TRIGGERS, first(sp.trigger)),
    q: first(sp.q)?.trim().slice(0, GATE_SEARCH_MAX_CHARS) || null,
  }
}

export function gateFilterParams(filters: GateFilters): Record<string, string | undefined> {
  return {
    review: filters.review === DEFAULT_GATE_REVIEW ? undefined : filters.review,
    verdict: filters.verdict ?? undefined,
    by: filters.decidedBy ?? undefined,
    source: filters.source ?? undefined,
    trigger: filters.trigger ?? undefined,
    q: filters.q ?? undefined,
  }
}

export function parseGateRange(raw: string | string[] | undefined): GateRangeDays {
  const days = Number(/^(\d{1,2})d$/.exec(first(raw) ?? '')?.[1])
  return GATE_RANGE_DAYS.find((option) => option === days) ?? DEFAULT_GATE_RANGE
}

export const gateRangeParam = (days: GateRangeDays): string => `${days}d`

const blankToNull = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? null : value

export const gateLabelFormSchema = z
  .object({
    id: z.guid(),
    label: z.enum(GATE_LABELS),
    reason: z.preprocess(blankToNull, gateLabelReasonSchema.nullish()),
    note: z.preprocess(blankToNull, z.string().trim().max(GATE_LABEL_NOTE_MAX_CHARS).nullish()),
  })
  .refine((input) => input.label === 'agree' || !!input.reason, {
    message: 'Pick a reason for the disagreement',
    path: ['reason'],
  })

export const gateBulkAgreeSchema = z.object({
  ids: z.array(z.guid()).min(1).max(GATE_BULK_LIMIT),
})

/** Reasons that fit a disagreement with this verdict: those arguing for the opposite verdict, plus the neutral ones. */
export function disagreeReasonsFor(verdict: GateVerdict): GateReasonOption[] {
  const shouldBe = oppositeGateVerdict(verdict)
  return GATE_LABEL_REASONS.filter(
    (reason) => reason.shouldBe === null || reason.shouldBe === shouldBe,
  ).map(({ key, label }) => ({ key, label }))
}

export function isDisagreeReasonFor(verdict: GateVerdict, reason: GateLabelReason): boolean {
  return disagreeReasonsFor(verdict).some((option) => option.key === reason)
}

const EXPLORE_DECIDER: GateDecidedBy = 'explore'
const MANUAL_TRIGGER: GateTrigger = 'manual'

/** SQL twin of core's judgeWasRight over a gate_decision row; null (not counted) while the row is unlabelled. */
export const JUDGE_WAS_RIGHT_SQL = `(label = 'agree') <> (decided_by = '${EXPLORE_DECIDER}')`

const REVIEW_QUESTIONS: Record<GateVerdict, string> = {
  reel: 'Was making this a reel the right call?',
  source_only: 'Was keeping this as source only the right call?',
}

const DISAGREE_PROMPTS: Record<GateVerdict, string> = {
  reel: 'Why should this not be a reel?',
  source_only: 'Why should this be a reel?',
}

// A live "source only" that was not applied means a user asked for this item just before it settled, so it was made anyway.
function appliedNote(
  row: Pick<GateDecisionRow, 'applied' | 'mode' | 'trigger'>,
  verdict: GateVerdict,
): string | null {
  if (row.applied) return null
  if (row.trigger === MANUAL_TRIGGER) return 'Not applied: manual check, analysis only'
  if (row.mode !== 'live') return 'Not applied: shadow mode'
  return verdict === 'source_only' ? 'Not applied: requested by a user' : 'Not applied'
}

function reasonLabel(key: string | null): string | null {
  if (!key) return null
  return GATE_LABEL_REASONS.find((reason) => reason.key === key)?.label ?? key
}

/** Pure projection of a stored decision onto what the queue and the item drawer render; null for a row with an unknown verdict. */
export function toGateView(row: GateDecisionRow): GateView | null {
  const verdict = gateVerdictSchema.safeParse(row.verdict)
  if (!verdict.success) return null
  const signals = parseGateSignals(row.signals)
  const label = z.enum(GATE_LABELS).safeParse(row.label)
  return {
    decisionId: row.id,
    itemId: row.item_id,
    verdict: verdict.data,
    judgeVerdict: judgeVerdict({ verdict: verdict.data, decidedBy: row.decided_by }),
    explored: row.decided_by === EXPLORE_DECIDER,
    manual: row.trigger === MANUAL_TRIGGER,
    reviewQuestion: REVIEW_QUESTIONS[verdict.data],
    disagreePrompt: DISAGREE_PROMPTS[verdict.data],
    score: row.score === null ? null : Number(row.score),
    threshold: Number(row.threshold),
    scoreMax: GATE_SCORE_MAX,
    signals: GATE_SIGNALS.map(({ key, label: signalLabel }) => {
      const value = signals[key] ?? null
      return { key, label: signalLabel, value, pct: ((value ?? 0) / GATE_SIGNAL_MAX) * 100 }
    }),
    reasons: row.reasons ?? [],
    rationale: row.rationale ?? '',
    decidedBy: row.decided_by,
    rule: row.rule,
    mode: row.mode,
    applied: row.applied,
    appliedNote: appliedNote(row, verdict.data),
    model: row.model,
    promptVersion: row.prompt_version,
    decidedAt: new Date(row.created_at).toISOString(),
    label: label.success ? label.data : null,
    labelReason: reasonLabel(row.label_reason),
    labelNote: row.label_note,
    disagreeReasons: disagreeReasonsFor(verdict.data),
  }
}

export type GateTrendRow = { day: string; verdict: string; decisions: number }
export type GateTrendPoint = { x: string; reel: number; source_only: number }

/** One point per day key, zero-filled, so the trend chart never skips a quiet day. */
export function gateTrendPoints(
  rows: readonly GateTrendRow[],
  days: readonly string[],
): GateTrendPoint[] {
  const byDay = new Map(days.map((day) => [day, { x: day, reel: 0, source_only: 0 }]))
  for (const row of rows) {
    const point = byDay.get(row.day)
    const verdict = gateVerdictSchema.safeParse(row.verdict)
    if (point && verdict.success) point[verdict.data] += row.decisions
  }
  return [...byDay.values()]
}

export function share(part: number, whole: number): number | null {
  return whole > 0 ? part / whole : null
}
