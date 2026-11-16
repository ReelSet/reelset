import {
  ItemStatus,
  StaleTransitionError,
  clearGateLabel,
  errorFields,
  gateConfigHash,
  gateVerdictSchema,
  labelGateDecision,
  listInstagramPerformance,
  loadGateConfig,
  performanceMetric,
  recordGateDecision,
  selectPerformanceExamples,
  setSetting,
  transitionItem,
  type Database,
  type GateConfig,
  type GateDecisionRow,
  type Logger,
  type SettingDef,
} from '@reelset/core'
import { z } from 'zod'
import {
  GATE_BULK_LIMIT,
  gateBulkAgreeSchema,
  gateLabelFormSchema,
  isDisagreeReasonFor,
} from '@/lib/admin/gate'
import {
  GATE_SETTING_DEFS,
  isEditableGateSetting,
  parseGateSettingsForm,
  parseGateTuningForm,
  sourceThresholds,
  type GateFormFields,
  type EditableGateSetting,
} from '@/lib/admin/gate-settings'
import {
  DRY_RUN_SAMPLE,
  SUGGEST_SAMPLE,
  dryRunGate,
  suggestThreshold,
  type DryRunResult,
  type ThresholdSuggestion,
} from '@/lib/admin/gate-tuning'
import type { PerformanceStatus } from '@/lib/admin/gate-fields'
import { VERDICT_LABELS } from '@/lib/admin/gate-view'
import type { CommandResult } from './commands'
import { recentJudgedDecisions } from './gate-queries'

export const GATE_OVERRIDE_META_KEY = 'gateOverride'
const OVERRIDE_RATIONALE = 'Admin override: make a reel anyway'
const NOT_FOUND = { ok: false, message: 'Decision not found' } as const

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`

type LabelInput = { id: unknown; label: unknown; reason?: unknown; note?: unknown; adminId: string }
type Labelled = { ok: true; row: GateDecisionRow } | { ok: false; message: string }

async function applyLabel(db: Database, input: LabelInput, log: Logger): Promise<Labelled> {
  const parsed = gateLabelFormSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid review' }
  }
  const { id, label, reason, note } = parsed.data
  if (label === 'disagree' && reason) {
    const decision = await db
      .selectFrom('gate_decision')
      .select('verdict')
      .where('id', '=', id)
      .executeTakeFirst()
    if (!decision) return NOT_FOUND
    const verdict = gateVerdictSchema.safeParse(decision.verdict)
    if (verdict.success && !isDisagreeReasonFor(verdict.data, reason)) {
      const name = VERDICT_LABELS[verdict.data].toLowerCase()
      return { ok: false, message: `That reason does not fit a "${name}" decision` }
    }
  }
  const row = await labelGateDecision(db, { id, label, reason, note, adminId: input.adminId }, log)
  return row ? { ok: true, row } : NOT_FOUND
}

/** Saves an admin's agree or disagree on one decision; a disagreement needs a reason that fits the verdict. */
export async function labelDecision(
  db: Database,
  input: LabelInput,
  log: Logger,
): Promise<CommandResult> {
  const labelled = await applyLabel(db, input, log.child({ fn: 'labelDecision' }))
  if (!labelled.ok) return labelled
  return {
    ok: true,
    message: labelled.row.label === 'agree' ? 'Marked as agreed' : 'Marked as disagreed',
  }
}

export async function clearDecisionLabel(
  db: Database,
  input: { id: unknown },
  log: Logger,
): Promise<CommandResult> {
  const id = z.guid().safeParse(input.id)
  if (!id.success) return { ok: false, message: 'Invalid decision id' }
  const row = await clearGateLabel(db, id.data, log.child({ fn: 'clearDecisionLabel' }))
  return row
    ? { ok: true, message: 'Review cleared; the decision is back in the queue' }
    : NOT_FOUND
}

/** Agrees with every selected decision that has no review yet; reviewed ones are left as they are. */
export async function bulkAgree(
  db: Database,
  input: { ids: unknown; adminId: string },
  log: Logger,
): Promise<CommandResult> {
  const parsed = gateBulkAgreeSchema.safeParse({ ids: input.ids })
  if (!parsed.success)
    return { ok: false, message: `Select between 1 and ${GATE_BULK_LIMIT} decisions` }
  const { ids } = parsed.data
  const result = await db
    .updateTable('gate_decision')
    .set({
      label: 'agree',
      label_reason: null,
      label_note: null,
      labeled_by: input.adminId,
      labeled_at: new Date(),
    })
    .where('id', 'in', ids)
    .where('label', 'is', null)
    .where('decided_by', '<>', 'admin')
    .executeTakeFirst()
  const agreed = Number(result.numUpdatedRows)
  log.info({ fn: 'bulkAgree', selected: ids.length, agreed }, 'gate decisions agreed in bulk')
  if (agreed === 0) return { ok: false, message: 'Nothing changed: those are already reviewed' }
  const skipped = ids.length - agreed
  const suffix = skipped > 0 ? `, ${skipped} already reviewed` : ''
  return { ok: true, message: `Agreed with ${plural(agreed, 'decision')}${suffix}` }
}

async function overrideDecision(config: GateConfig, itemId: string) {
  return {
    itemId,
    verdict: 'reel' as const,
    threshold: config.threshold,
    rationale: OVERRIDE_RATIONALE,
    decidedBy: 'admin' as const,
    mode: config.mode === 'shadow' ? ('shadow' as const) : ('live' as const),
    applied: true,
    configHash: await gateConfigHash(config),
  }
}

/** Sends a source-only item back to be made into a reel and records the admin decision that stops the gate judging it again. */
export async function makeReelAnyway(
  db: Database,
  input: { itemId: unknown; adminId: string },
  log: Logger,
): Promise<CommandResult> {
  const id = z.guid().safeParse(input.itemId)
  if (!id.success) return { ok: false, message: 'Invalid item id' }
  const itemId = id.data
  const l = log.child({ fn: 'makeReelAnyway', itemId })
  const decision = await overrideDecision(await loadGateConfig(db, l), itemId)
  try {
    await db.transaction().execute(async (trx) => {
      await transitionItem(
        trx,
        {
          itemId,
          from: ItemStatus.source_only,
          to: ItemStatus.found,
          meta: { [GATE_OVERRIDE_META_KEY]: true, adminId: input.adminId },
        },
        l,
      )
      await trx
        .updateTable('item')
        .set({ queued_at: null, attempts: 0 })
        .where('id', '=', itemId)
        .execute()
      await recordGateDecision(trx, decision, l)
    })
  } catch (err) {
    if (!(err instanceof StaleTransitionError)) throw err
    l.warn('override refused: item is not source only')
    return { ok: false, message: 'Item is not source only, so there is nothing to override' }
  }
  l.info({ adminId: input.adminId }, 'source-only item sent back to become a reel')
  return {
    ok: true,
    message: 'Item sent back to become a reel; ingest picks it up on its next run',
  }
}

/** Disagrees with a "source only" decision and overrides it in one step; the disagreement stays saved if the override is refused. */
export async function disagreeAndMakeReel(
  db: Database,
  input: Omit<LabelInput, 'label'>,
  log: Logger,
): Promise<CommandResult> {
  const l = log.child({ fn: 'disagreeAndMakeReel' })
  const labelled = await applyLabel(db, { ...input, label: 'disagree' }, l)
  if (!labelled.ok) return labelled
  if (labelled.row.verdict !== 'source_only') {
    return {
      ok: false,
      message: 'Disagreement saved. Only a source-only decision can be overridden',
    }
  }
  const override = await makeReelAnyway(
    db,
    { itemId: labelled.row.item_id, adminId: input.adminId },
    l,
  )
  if (!override.ok) return { ok: false, message: `Disagreement saved. ${override.message}` }
  return { ok: true, message: `Marked as disagreed. ${override.message}` }
}

/** Validates the submitted gate settings and writes them together, so a threshold never lands without its weights. */
export async function saveGateSettings(
  db: Database,
  fields: GateFormFields,
  log: Logger,
): Promise<CommandResult> {
  const l = log.child({ fn: 'saveGateSettings' })
  const parsed = parseGateSettingsForm(fields)
  if (!parsed.ok) {
    l.info({ error: parsed.error }, 'gate settings rejected')
    return { ok: false, message: parsed.error }
  }
  const names = Object.keys(parsed.value) as EditableGateSetting[]
  await db.transaction().execute(async (trx) => {
    for (const name of names) {
      await setSetting(trx, GATE_SETTING_DEFS[name] as SettingDef<unknown>, parsed.value[name], l)
    }
  })
  return {
    ok: true,
    message: `Saved ${names.map((name) => GATE_SETTING_DEFS[name].key).join(', ')}`,
  }
}

export async function resetGateSetting(
  db: Database,
  input: { name: unknown },
  log: Logger,
): Promise<CommandResult> {
  if (!isEditableGateSetting(input.name)) return { ok: false, message: 'Unknown gate setting' }
  const def = GATE_SETTING_DEFS[input.name] as SettingDef<unknown>
  await setSetting(db, def, def.default, log.child({ fn: 'resetGateSetting' }))
  return { ok: true, message: `${def.key} reset to default` }
}

/** The threshold that best matches the admin labels on current-version scores, or null when there are too few labels or the gate table cannot be read. */
export async function thresholdSuggestion(
  db: Database,
  tuning: Pick<GateConfig, 'threshold'>,
  log: Logger,
): Promise<ThresholdSuggestion | null> {
  try {
    const labelled = await recentJudgedDecisions(db, { limit: SUGGEST_SAMPLE, labelledOnly: true })
    return suggestThreshold(labelled, tuning.threshold)
  } catch (err) {
    log.warn(errorFields(err), 'gate threshold suggestion unavailable')
    return null
  }
}

export type GateDryRun =
  | { ok: true; result: DryRunResult; suggestion: ThresholdSuggestion | null; threshold: number }
  | { ok: false; message: string }

/** Re-cuts the stored scores of the newest current-version judgements against the typed (unsaved) threshold; no model call, nothing written. */
export async function testGateTuning(
  db: Database,
  fields: GateFormFields,
  log: Logger,
): Promise<GateDryRun> {
  const l = log.child({ fn: 'testGateTuning' })
  const parsed = parseGateTuningForm(fields)
  if (!parsed.ok) return { ok: false, message: parsed.error }
  const tuning = parsed.value
  try {
    const [config, decisions] = await Promise.all([
      loadGateConfig(db, l),
      recentJudgedDecisions(db, { limit: DRY_RUN_SAMPLE }),
    ])
    const result = dryRunGate(decisions, {
      ...tuning,
      sourceThresholds: sourceThresholds(config.sourceRules),
    })
    const suggestion = await thresholdSuggestion(db, tuning, l)
    return { ok: true, result, suggestion, threshold: tuning.threshold }
  } catch (err) {
    l.error(errorFields(err), 'gate dry run failed')
    return {
      ok: false,
      message: 'Could not read recent decisions; the gate table may not be set up yet',
    }
  }
}

/** The Instagram results the judge is shown under this limit, counted the way the ingest worker picks them; null when they cannot be read, so the page just omits the line. */
export async function performanceExampleStatus(
  db: Database,
  limit: number,
  log: Logger,
): Promise<PerformanceStatus | null> {
  try {
    const posts = await listInstagramPerformance(db)
    return {
      inUse: selectPerformanceExamples(posts, { limit }).length,
      metric: performanceMetric(posts),
    }
  } catch (err) {
    log.warn(errorFields(err), 'gate performance examples unavailable')
    return null
  }
}
