import {
  GATE_PROMPT_VERSION,
  applySourceRule,
  claudeCostUsd,
  errorFields,
  gateCallCostUsd,
  gateConfigHash,
  gateVerdict,
  gateVerdictSchema,
  latestGateDecision,
  listGateExamples,
  listInstagramPerformance,
  loadGateConfig,
  recordGateDecision,
  recordSpend,
  selectPerformanceExamples,
  shouldExplore,
  type ClaudeEffort,
  type ClaudeModel,
  type Database,
  type GateConfig,
  type GateDecisionInput,
  type GateDecisionMode,
  type GateDecisionRow,
  type GatePerformanceExample,
  type GateTrigger,
  type GateVerdict,
  type Logger,
} from '@reelset/core'
import { GATE_JUDGE_ATTEMPTS, GATE_TOTAL_TIMEOUT_MS } from '../config'
import { parseGateOutput, type GateJudgement } from './gate-output'
import { buildGatePrompt, type GatePrompt, type GateSubject } from './gate-prompt'
import { LLM_PROVIDER } from './llm'
import type { LlmClient } from './output'
import { QuotaExhaustedError } from './quota'

export type GateDeps = {
  /** A judge client for the admin-selected model and effort, with a small output ceiling. */
  judge: (model: ClaudeModel, effort: ClaudeEffort) => LlmClient
  /** Ceiling across the first call and the malformed-answer retry; defaults to GATE_TOTAL_TIMEOUT_MS. */
  totalTimeoutMs?: number
}

export type GateContext = {
  db: Database
  log: Logger
  gate: GateDeps
  /** What started the judgement, recorded with the spend; the pipeline is `auto`. */
  trigger?: GateTrigger
}

export type GateItem = GateSubject & {
  itemId: string
  /** The item's admission score, 0 to 1. */
  itemScore: number
  /** A user asked (and paid) for this reel. */
  requested: boolean
  /** The item has been a finished reel before, so it may already be live in the feed or posted. */
  renderedBefore: boolean
  /** When the item entered its current status; decisions made since then belong to this pass. */
  inStatusSince: Date | null
}

export type GateSkipReason =
  'off' | 'requested' | 'rendered_before' | 'admin_override' | 'over_budget' | 'error'

export type GateResult =
  | { kind: 'skipped'; reason: GateSkipReason }
  | {
      kind: 'decided'
      decisionId: string
      verdict: GateVerdict
      score: number | null
      decidedBy: string
      /** True only in live mode: the verdict must be acted on. */
      applied: boolean
    }

export class GateJudgeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GateJudgeError'
  }
}

export class GateTimeoutError extends Error {
  constructor(ms: number) {
    super(`gate judge gave no answer within ${ms} ms`)
    this.name = 'GateTimeoutError'
  }
}

export class GateBudgetError extends Error {
  constructor(
    readonly model: ClaudeModel,
    readonly maxCostUsd: number,
    readonly minCostUsd: number,
  ) {
    super(
      `one ${model} gate call costs about $${minCostUsd.toFixed(4)}, over the $${maxCostUsd} cap`,
    )
    this.name = 'GateBudgetError'
  }
}

async function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new GateTimeoutError(ms)), ms)
  })
  try {
    return await Promise.race([work, expired])
  } finally {
    clearTimeout(timer)
  }
}

/** Why a malformed answer may not be retried: the next call would break the cost cap or the time ceiling. Null means go ahead. */
export function retryBlocker(input: {
  spentUsd: number
  nextCallUsd: number
  maxCostUsd: number
  remainingMs: number
}): 'cost_cap' | 'time_ceiling' | null {
  if (input.spentUsd + input.nextCallUsd > input.maxCostUsd) return 'cost_cap'
  if (input.remainingMs <= 0) return 'time_ceiling'
  return null
}

export type DecisionDraft = Omit<
  GateDecisionInput,
  'itemId' | 'mode' | 'applied' | 'promptVersion' | 'configHash'
>

/** Items the gate never judges, whatever its settings: paid requests, and reels that were already made. */
export function exemptReason(
  item: Pick<GateItem, 'requested' | 'renderedBefore'>,
): Extract<GateSkipReason, 'requested' | 'rendered_before'> | null {
  if (item.requested) return 'requested'
  if (item.renderedBefore) return 'rendered_before'
  return null
}

/** An admin's "make a reel anyway" is the item's latest word and must not be judged away again. */
export function isAdminReelOverride(latest: GateDecisionRow | null): boolean {
  return latest?.decided_by === 'admin' && latest.verdict === 'reel' && latest.trigger !== 'manual'
}

/** The decision already made in this pass under the same settings, so a redelivery neither pays for nor records a second one. */
export function reusableDecision(
  latest: GateDecisionRow | null,
  current: { configHash: string; mode: GateDecisionMode; since: Date | null },
): GateDecisionRow | null {
  if (!latest || !current.since || latest.decided_by === 'admin') return null
  if (latest.trigger === 'manual') return null
  const sameSettings =
    latest.mode === current.mode &&
    latest.config_hash === current.configHash &&
    latest.prompt_version === GATE_PROMPT_VERSION
  if (!sameSettings) return null
  return new Date(latest.created_at).getTime() >= current.since.getTime() ? latest : null
}

/** Turns the judge's rating into a verdict (rating at or above the threshold is a reel); a rejected item in the explore sample is let through as a reel. */
export function settleJudgement(
  itemId: string,
  judgement: GateJudgement,
  threshold: number,
  config: Pick<GateConfig, 'exploreRate'>,
): { verdict: GateVerdict; decidedBy: 'model' | 'explore'; score: number } {
  const { score } = judgement
  const verdict = gateVerdict(score, threshold)
  if (verdict === 'source_only' && shouldExplore(itemId, config.exploreRate)) {
    return { verdict: 'reel', decidedBy: 'explore', score }
  }
  return { verdict, decidedBy: 'model', score }
}

async function callJudge(
  ctx: GateContext,
  item: GateItem,
  config: GateConfig,
  prompt: GatePrompt,
  call: { attempt: number; timeoutMs: number },
): Promise<{ text: string; costUsd: number }> {
  const client = ctx.gate.judge(config.model, config.effort)
  const result = await withDeadline(client.generate(prompt), call.timeoutMs)
  const costUsd = claudeCostUsd(config.model, result.usage)
  await recordSpend(
    ctx.db,
    {
      category: 'llm',
      units: result.usage.inputTokens + result.usage.outputTokens,
      costUsd,
      meta: {
        purpose: 'gate',
        trigger: ctx.trigger ?? 'auto',
        model: config.model,
        provider: LLM_PROVIDER,
        itemId: item.itemId,
        attempt: call.attempt,
      },
    },
    ctx.log,
  )
  ctx.log.info(
    {
      attempt: call.attempt,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      costUsd,
    },
    'gate judge call done',
  )
  return { text: result.text, costUsd }
}

/** The account's clear Instagram winners and losers for the judge, never the item being judged or one an admin already labelled. A failed lookup yields none: performance must not stop a judgement. */
async function loadPerformanceExamples(
  ctx: GateContext,
  limit: number,
  excludeItemIds: readonly string[],
): Promise<GatePerformanceExample[]> {
  if (!(limit > 0)) return []
  try {
    const posts = await listInstagramPerformance(ctx.db)
    return selectPerformanceExamples(posts, { limit, excludeItemIds: new Set(excludeItemIds) })
  } catch (err) {
    ctx.log.warn(errorFields(err), 'instagram performance lookup failed, judging without it')
    return []
  }
}

async function askJudge(
  ctx: GateContext,
  item: GateItem,
  config: GateConfig,
): Promise<{ judgement: GateJudgement; costUsd: number }> {
  const examples =
    config.exampleCount > 0 ? await listGateExamples(ctx.db, { limit: config.exampleCount }) : []
  const performance = await loadPerformanceExamples(ctx, config.performanceExamples, [
    item.itemId,
    ...examples.map((example) => example.itemId),
  ])
  const { budget, prompt, performanceShown } = buildGatePrompt(config, examples, item, performance)
  if (!prompt) throw new GateBudgetError(config.model, config.maxCostUsdPerItem, budget.minCostUsd)
  ctx.log.info(
    { examples: examples.length, performance: performanceShown, found: performance.length },
    'gate prompt built',
  )

  const deadline = Date.now() + (ctx.gate.totalTimeoutMs ?? GATE_TOTAL_TIMEOUT_MS)
  const nextCallUsd = gateCallCostUsd(config.model, prompt.system.length + prompt.user.length)
  let spentUsd = 0
  let reason = 'no answer'
  for (let attempt = 1; attempt <= GATE_JUDGE_ATTEMPTS; attempt++) {
    const remainingMs = deadline - Date.now()
    const blocker =
      attempt === 1
        ? null
        : retryBlocker({ spentUsd, nextCallUsd, maxCostUsd: config.maxCostUsdPerItem, remainingMs })
    if (blocker) throw new GateJudgeError(`gate answer malformed (${reason}); no retry: ${blocker}`)
    const call = await callJudge(ctx, item, config, prompt, { attempt, timeoutMs: remainingMs })
    spentUsd += call.costUsd
    const parsed = parseGateOutput(call.text)
    if (parsed.ok) return { judgement: parsed.value, costUsd: spentUsd }
    reason = parsed.reason
    ctx.log.warn({ attempt, reason }, 'gate answer malformed')
  }
  throw new GateJudgeError(`gate answer malformed after ${GATE_JUDGE_ATTEMPTS} calls: ${reason}`)
}

/** Settles one item by its source rule or by asking the judge; throws when the judge cannot answer. Records spend but no decision. */
export async function draftDecision(
  ctx: GateContext,
  item: GateItem,
  config: GateConfig,
): Promise<DecisionDraft> {
  const outcome = applySourceRule(item.source, item.itemScore, config)
  if (outcome.kind === 'verdict') {
    return {
      verdict: outcome.verdict,
      threshold: outcome.threshold,
      decidedBy: 'rule',
      rule: outcome.rule,
    }
  }
  const { judgement, costUsd } = await askJudge(ctx, item, config)
  const settled = settleJudgement(item.itemId, judgement, outcome.threshold, config)
  return {
    ...settled,
    threshold: outcome.threshold,
    reasons: judgement.reasons,
    rationale: judgement.rationale,
    model: config.model,
    costUsd,
  }
}

function decided(row: GateDecisionRow): GateResult {
  return {
    kind: 'decided',
    decisionId: row.id,
    verdict: gateVerdictSchema.parse(row.verdict),
    score: row.score === null ? null : Number(row.score),
    decidedBy: row.decided_by,
    applied: row.applied,
  }
}

async function decide(ctx: GateContext, item: GateItem): Promise<GateResult> {
  const { db, log } = ctx
  const config = await loadGateConfig(db, log)
  if (config.mode === 'off') return { kind: 'skipped', reason: 'off' }
  const latest = await latestGateDecision(db, item.itemId)
  if (isAdminReelOverride(latest)) return { kind: 'skipped', reason: 'admin_override' }

  const configHash = await gateConfigHash(config)
  const reused = reusableDecision(latest, {
    configHash,
    mode: config.mode,
    since: item.inStatusSince,
  })
  if (reused) {
    log.info({ decisionId: reused.id, verdict: reused.verdict }, 'gate decision reused')
    return decided(reused)
  }

  const draft = await draftDecision(ctx, item, config)
  const row = await recordGateDecision(
    db,
    {
      ...draft,
      itemId: item.itemId,
      mode: config.mode,
      applied: config.mode === 'live',
      promptVersion: GATE_PROMPT_VERSION,
      configHash,
    },
    log,
  )
  return decided(row)
}

/** Judges one item and records the decision. Fails open: any error but a quota error is logged and reported as skipped, so the item goes on to its script. */
export async function runGate(ctx: GateContext, item: GateItem): Promise<GateResult> {
  const log = ctx.log.child({ itemId: item.itemId, mod: 'gate' })
  const exempt = exemptReason(item)
  if (exempt) {
    log.info({ reason: exempt }, 'gate skipped')
    return { kind: 'skipped', reason: exempt }
  }
  try {
    const result = await decide({ ...ctx, log }, item)
    if (result.kind === 'skipped') log.info({ reason: result.reason }, 'gate skipped')
    return result
  } catch (err) {
    if (err instanceof QuotaExhaustedError) throw err
    if (err instanceof GateBudgetError) {
      log.warn(
        { model: err.model, maxCostUsdPerItem: err.maxCostUsd, minCallCostUsd: err.minCostUsd },
        'gate skipped: one judge call does not fit under the per-item cost cap at this model',
      )
      return { kind: 'skipped', reason: 'over_budget' }
    }
    log.error(errorFields(err), 'gate failed, item continues to the script')
    return { kind: 'skipped', reason: 'error' }
  }
}

/** Marks a recorded decision as not acted on, for a live verdict that was overtaken before it could be applied. */
export async function markDecisionNotApplied(
  db: Database,
  decisionId: string,
  log: Logger,
): Promise<void> {
  await db
    .updateTable('gate_decision')
    .set({ applied: false })
    .where('id', '=', decisionId)
    .execute()
  log.info({ decisionId }, 'gate decision marked not applied')
}
