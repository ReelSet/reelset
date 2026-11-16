import { sql, type Selectable } from 'kysely'
import { z } from 'zod'
import type { Database } from '../db/client'
import { Source } from '../db/enums'
import type { GateDecision } from '../db/types'
import {
  GATE_DECIDERS,
  GATE_LABELS,
  GATE_PROMPT_VERSION,
  GATE_SCORE_MAX,
  GATE_TRIGGERS,
  GATE_VERDICTS,
  correctGateVerdict,
  currentGateInstructions,
  gateLabelReasonSchema,
  gateVerdictSchema,
  parseGateSignals,
  type GateConfig,
  type GateDecidedBy,
  type GateDecisionMode,
  type GateLabel,
  type GateLabelReason,
  type GateSignals,
  type GateTrigger,
  type GateVerdict,
} from '../domain/gate'
import type { Logger } from '../lib/logger'
import { SETTINGS, parseSetting, type SettingDef } from './settings.repo'

export type GateDecisionRow = Selectable<GateDecision>

export const GATE_REASONS_MAX = 6
export const GATE_REASON_MAX_CHARS = 120
export const GATE_RATIONALE_MAX_CHARS = 600
export const GATE_LABEL_NOTE_MAX_CHARS = 500
export const GATE_EXAMPLES_MAX = 50

export type GateDecisionInput = {
  itemId: string
  verdict: GateVerdict
  score?: number | null
  threshold: number
  signals?: GateSignals
  reasons?: readonly string[]
  rationale?: string
  decidedBy: GateDecidedBy
  rule?: string | null
  mode: GateDecisionMode
  applied: boolean
  model?: string | null
  promptVersion?: string
  configHash: string
  costUsd?: number
  /** Defaults to `auto`; `manual` marks an on-demand judgement that must never be applied. */
  trigger?: GateTrigger
}

function shortPhrases(phrases: readonly string[]): string[] {
  return phrases
    .map((phrase) => phrase.trim().slice(0, GATE_REASON_MAX_CHARS))
    .filter(Boolean)
    .slice(0, GATE_REASONS_MAX)
}

const percent = z.number().min(0).max(GATE_SCORE_MAX)

// Model text is cut to size, never rejected, so an over-long rationale cannot lose a decision.
const decisionInputSchema = z
  .object({
    itemId: z.string().min(1),
    verdict: gateVerdictSchema,
    score: percent.nullish().transform((score) => score ?? null),
    threshold: percent,
    signals: z.unknown().optional().transform(parseGateSignals),
    reasons: z.array(z.string()).default([]).transform(shortPhrases),
    rationale: z
      .string()
      .default('')
      .transform((text) => text.trim().slice(0, GATE_RATIONALE_MAX_CHARS)),
    decidedBy: z.enum(GATE_DECIDERS),
    rule: z
      .string()
      .min(1)
      .max(64)
      .nullish()
      .transform((rule) => rule ?? null),
    mode: z.enum(['shadow', 'live']),
    applied: z.boolean(),
    model: z
      .string()
      .min(1)
      .nullish()
      .transform((model) => model ?? null),
    promptVersion: z.string().min(1).default(GATE_PROMPT_VERSION),
    configHash: z.string().min(1),
    costUsd: z.number().min(0).default(0),
    trigger: z.enum(GATE_TRIGGERS).default('auto'),
  })
  .refine((decision) => decision.decidedBy !== 'rule' || decision.rule !== null, {
    message: 'a rule decision must name the rule that fired',
    path: ['rule'],
  })
  .refine((decision) => decision.trigger !== 'manual' || !decision.applied, {
    message: 'a manual judgement is never applied',
    path: ['applied'],
  })

/** Stores one judgement and returns the row; throws a ZodError on an input the table would reject. */
export async function recordGateDecision(
  db: Database,
  input: GateDecisionInput,
  log: Logger,
): Promise<GateDecisionRow> {
  const decision = decisionInputSchema.parse(input)
  const row = await db
    .insertInto('gate_decision')
    .values({
      item_id: decision.itemId,
      verdict: decision.verdict,
      score: decision.score,
      threshold: decision.threshold,
      signals: JSON.stringify(decision.signals),
      reasons: decision.reasons,
      rationale: decision.rationale,
      decided_by: decision.decidedBy,
      rule: decision.rule,
      mode: decision.mode,
      applied: decision.applied,
      model: decision.model,
      prompt_version: decision.promptVersion,
      config_hash: decision.configHash,
      cost_usd: decision.costUsd,
      trigger: decision.trigger,
    })
    .returningAll()
    .executeTakeFirstOrThrow()
  log.info(
    {
      itemId: decision.itemId,
      decisionId: row.id,
      verdict: decision.verdict,
      score: decision.score,
      decidedBy: decision.decidedBy,
      rule: decision.rule,
      mode: decision.mode,
      applied: decision.applied,
      trigger: decision.trigger,
    },
    'gate decision recorded',
  )
  return row
}

/** The item's current decision (its newest pipeline or admin row), or null when it was never judged. Manual judgements are analysis only and never count. */
export async function latestGateDecision(
  db: Database,
  itemId: string,
): Promise<GateDecisionRow | null> {
  const row = await db
    .selectFrom('gate_decision')
    .selectAll()
    .where('item_id', '=', itemId)
    .where('trigger', '=', 'auto')
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .limit(1)
    .executeTakeFirst()
  return row ?? null
}

/** The newest judgement of any kind for an item, manual ones included: what to show when someone asks "what did the gate think of this". */
export async function latestGateJudgement(
  db: Database,
  itemId: string,
): Promise<GateDecisionRow | null> {
  const row = await db
    .selectFrom('gate_decision')
    .selectAll()
    .where('item_id', '=', itemId)
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .limit(1)
    .executeTakeFirst()
  return row ?? null
}

export type GateLabelInput = {
  id: string
  label: GateLabel
  reason?: GateLabelReason | null
  note?: string | null
  adminId: string
}

const labelInputSchema = z
  .object({
    id: z.string().min(1),
    label: z.enum(GATE_LABELS),
    reason: gateLabelReasonSchema.nullish().transform((reason) => reason ?? null),
    note: z
      .string()
      .trim()
      .max(GATE_LABEL_NOTE_MAX_CHARS)
      .nullish()
      .transform((note) => note || null),
    adminId: z.string().min(1),
  })
  .refine((input) => input.label === 'agree' || input.reason !== null, {
    message: 'a disagreement needs a reason',
    path: ['reason'],
  })

/** Saves an admin's review of a decision, replacing any earlier one; an agreement stores no reason. Null when the decision is gone. */
export async function labelGateDecision(
  db: Database,
  input: GateLabelInput,
  log: Logger,
): Promise<GateDecisionRow | null> {
  const review = labelInputSchema.parse(input)
  const row = await db
    .updateTable('gate_decision')
    .set({
      label: review.label,
      label_reason: review.label === 'disagree' ? review.reason : null,
      label_note: review.note,
      labeled_by: review.adminId,
      labeled_at: sql`now()`,
    })
    .where('id', '=', review.id)
    .returningAll()
    .executeTakeFirst()
  log.info(
    { decisionId: review.id, label: review.label, reason: review.reason, found: !!row },
    'gate decision labelled',
  )
  return row ?? null
}

/** Removes an admin's review so the decision returns to the review queue. Null when the decision is gone. */
export async function clearGateLabel(
  db: Database,
  id: string,
  log: Logger,
): Promise<GateDecisionRow | null> {
  const row = await db
    .updateTable('gate_decision')
    .set({
      label: null,
      label_reason: null,
      label_note: null,
      labeled_by: null,
      labeled_at: null,
    })
    .where('id', '=', id)
    .returningAll()
    .executeTakeFirst()
  log.info({ decisionId: id, found: !!row }, 'gate label cleared')
  return row ?? null
}

const sourceList = sql.raw(
  Object.values(Source)
    .map((source) => `'${source}'`)
    .join(', '),
)

// An item has no source column: take its top-scored mention, else the canonical key prefix.
const itemSource = sql<string>`coalesce(
  (select m.source::text from mention m where m.item_id = item.id order by m.score desc nulls last limit 1),
  case when split_part(item.canonical_key, ':', 1) in (${sourceList})
    then split_part(item.canonical_key, ':', 1) else 'unknown' end
)`

export type GateItemSource = Source | 'unknown'

export type GateExample = {
  decisionId: string
  itemId: string
  title: string
  url: string
  source: GateItemSource
  verdict: GateVerdict
  decidedBy: GateDecidedBy
  label: GateLabel
  correctVerdict: GateVerdict
  labelReason: GateLabelReason | null
  labelNote: string | null
  score: number | null
  labeledAt: Date
}

type GateExampleRow = {
  id: string
  item_id: string
  title: string
  canonical_url: string
  source: string
  verdict: string
  decided_by: string
  label: string
  label_reason: string | null
  label_note: string | null
  score: number | null
  labeled_at: Date | string
}

function toItemSource(value: string): GateItemSource {
  return (Object.values(Source) as string[]).includes(value) ? (value as Source) : 'unknown'
}

function toGateExample(row: GateExampleRow): GateExample | null {
  const verdict = gateVerdictSchema.safeParse(row.verdict)
  const label = z.enum(GATE_LABELS).safeParse(row.label)
  const decidedBy = z.enum(GATE_DECIDERS).safeParse(row.decided_by)
  if (!verdict.success || !label.success || !decidedBy.success) return null
  const reason = gateLabelReasonSchema.safeParse(row.label_reason)
  return {
    decisionId: row.id,
    itemId: row.item_id,
    title: row.title,
    url: row.canonical_url,
    source: toItemSource(row.source),
    verdict: verdict.data,
    decidedBy: decidedBy.data,
    label: label.data,
    correctVerdict: correctGateVerdict(verdict.data, label.data),
    labelReason: reason.success ? reason.data : null,
    labelNote: row.label_note,
    score: row.score === null ? null : Number(row.score),
    labeledAt: new Date(row.labeled_at),
  }
}

/** Admin-labelled decisions to show the judge, newest first: one per item, split evenly between "should be a reel" and "should be source only", topped up from one side when the other runs short. */
export async function listGateExamples(
  db: Database,
  opts: { limit: number },
): Promise<GateExample[]> {
  const limit = Math.min(Math.max(Math.trunc(opts.limit), 0), GATE_EXAMPLES_MAX)
  if (!(limit > 0)) return []
  const { rows } = await sql<GateExampleRow>`
    with labelled as (
      select distinct on (d.item_id)
        d.id, d.item_id, d.verdict, d.decided_by, d.label, d.label_reason, d.label_note, d.score,
        d.labeled_at,
        (d.label = 'agree') = (d.verdict = 'reel') as should_be_reel
      from gate_decision d
      where d.label is not null
      order by d.item_id, d.labeled_at desc
    ),
    ranked as (
      select labelled.*,
        row_number() over (partition by should_be_reel order by labeled_at desc) as side_rank
      from labelled
    )
    select ranked.id, ranked.item_id, item.title, item.canonical_url, ${itemSource} as source,
      ranked.verdict, ranked.decided_by, ranked.label, ranked.label_reason, ranked.label_note,
      ranked.score, ranked.labeled_at
    from ranked
    join item on item.id = ranked.item_id
    order by ranked.side_rank, ranked.labeled_at desc
    limit ${limit}
  `.execute(db)
  return rows
    .map(toGateExample)
    .filter((example): example is GateExample => example !== null)
    .sort((a, b) => b.labeledAt.getTime() - a.labeledAt.getTime())
}

export type GateStatsRow = {
  verdict: string
  decided_by: string
  source: string
  decisions: number | string
  labelled: number | string
  agreed: number | string
  cost_usd: number | string
}

export type GateVerdictCounts = Record<GateVerdict, number>

export type GateStats = {
  total: number
  byVerdict: GateVerdictCounts
  byDecidedBy: Record<GateDecidedBy, number>
  bySource: Partial<Record<GateItemSource, GateVerdictCounts>>
  labelled: number
  agreed: number
  agreementRate: number | null
  costUsd: number
}

function zeroCounts<K extends string>(keys: readonly K[]): Record<K, number> {
  return Object.fromEntries(keys.map((key) => [key, 0])) as Record<K, number>
}

/** Folds the grouped rows of gateStats into totals; rows with a verdict or decider outside the known sets are ignored. `agreed` measures the judge, so an agree on an explore row (the judge had said source only) counts against it. */
export function summarizeGateStats(rows: readonly GateStatsRow[]): GateStats {
  const stats: GateStats = {
    total: 0,
    byVerdict: zeroCounts(GATE_VERDICTS),
    byDecidedBy: zeroCounts(GATE_DECIDERS),
    bySource: {},
    labelled: 0,
    agreed: 0,
    agreementRate: null,
    costUsd: 0,
  }
  for (const row of rows) {
    const verdict = gateVerdictSchema.safeParse(row.verdict)
    const decidedBy = z.enum(GATE_DECIDERS).safeParse(row.decided_by)
    if (!verdict.success || !decidedBy.success) continue
    const decisions = Number(row.decisions)
    const source = toItemSource(row.source)
    const sourceCounts = stats.bySource[source] ?? zeroCounts(GATE_VERDICTS)
    sourceCounts[verdict.data] += decisions
    stats.bySource[source] = sourceCounts
    stats.total += decisions
    stats.byVerdict[verdict.data] += decisions
    stats.byDecidedBy[decidedBy.data] += decisions
    const labelled = Number(row.labelled)
    const agreedWithOutcome = Number(row.agreed)
    stats.labelled += labelled
    stats.agreed += decidedBy.data === 'explore' ? labelled - agreedWithOutcome : agreedWithOutcome
    stats.costUsd += Number(row.cost_usd)
  }
  stats.agreementRate = stats.labelled > 0 ? stats.agreed / stats.labelled : null
  return stats
}

/** Counts every decision made since `since` (re-judgements included) by verdict, decider and source, with review agreement and judge spend. Covers one trigger at a time, the pipeline's `auto` rows unless asked for `manual`, so on-demand judgements never mix into the automatic numbers. */
export async function gateStats(
  db: Database,
  opts: { since: Date; trigger?: GateTrigger },
): Promise<GateStats> {
  const trigger = opts.trigger ?? 'auto'
  const { rows } = await sql<GateStatsRow>`
    select verdict, decided_by, source,
      count(*)::int as decisions,
      count(label)::int as labelled,
      count(*) filter (where label = 'agree')::int as agreed,
      coalesce(sum(cost_usd), 0)::float8 as cost_usd
    from (
      select d.verdict, d.decided_by, d.label, d.cost_usd, ${itemSource} as source
      from gate_decision d
      join item on item.id = d.item_id
      where d.created_at >= ${opts.since} and d.trigger = ${trigger}
    ) decided
    group by verdict, decided_by, source
  `.execute(db)
  return summarizeGateStats(rows)
}

const GATE_CONFIG_SETTINGS = {
  mode: SETTINGS.gateMode,
  threshold: SETTINGS.gateThreshold,
  weights: SETTINGS.gateWeights,
  sourceRules: SETTINGS.gateSourceRules,
  instructions: SETTINGS.gateInstructions,
  model: SETTINGS.gateModel,
  effort: SETTINGS.gateEffort,
  exploreRate: SETTINGS.gateExploreRate,
  exampleCount: SETTINGS.gateExampleCount,
  performanceExamples: SETTINGS.gatePerformanceExamples,
  maxCostUsdPerItem: SETTINGS.gateMaxCostUsdPerItem,
} satisfies { [Field in keyof GateConfig]: SettingDef<GateConfig[Field]> }

/** Reads every gate setting in one query; a missing or invalid row falls back to its default, and so do instructions that are an untouched copy of an older default. */
export async function loadGateConfig(db: Database, log: Logger): Promise<GateConfig> {
  const settings = Object.entries(GATE_CONFIG_SETTINGS) as [keyof GateConfig, SettingDef<unknown>][]
  const rows = await db
    .selectFrom('app_setting')
    .select(['key', 'value'])
    .where(
      'key',
      'in',
      settings.map(([, setting]) => setting.key),
    )
    .execute()
  const stored = new Map(rows.map((row) => [row.key, row.value]))
  const config = settings.map(([field, setting]) => [
    field,
    parseSetting(setting, stored.get(setting.key), log),
  ])
  const loaded = Object.fromEntries(config) as GateConfig
  return { ...loaded, instructions: currentGateInstructions(loaded.instructions) }
}
