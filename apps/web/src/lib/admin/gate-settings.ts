import {
  CLAUDE_MODELS,
  GATE_EVIDENCE_MAX_CHARS,
  GATE_PROMPT_OVERHEAD_CHARS,
  gateCallBudget,
  gateCallCostUsd,
  SETTINGS,
  SOURCES,
  type GateConfig,
  type GateSourceRules,
  type SettingDef,
} from '@reelset/core'
import { GATE_FIELD, type CostMarks } from './gate-fields'

export const GATE_SETTING_DEFS = {
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

export type GateSettingName = keyof GateConfig
export type GateSettingsPatch = Partial<GateConfig>
export type GateFormFields = Readonly<Record<string, string>>
export type ParsedGateForm<T> = { ok: true; value: T } | { ok: false; error: string }

const PERCENT = 100

export function isGateSettingName(name: unknown): name is GateSettingName {
  return typeof name === 'string' && Object.hasOwn(GATE_SETTING_DEFS, name)
}

export function isEditableGateSetting(name: unknown): name is EditableGateSetting {
  return typeof name === 'string' && Object.hasOwn(CANDIDATES, name)
}

/** Whether a stored value equals the default; both sides come out of the same zod schema, so key order matches. */
export function isGateSettingDefault(name: GateSettingName, value: unknown): boolean {
  return JSON.stringify(value) === JSON.stringify(GATE_SETTING_DEFS[name].default)
}

/** String fields of a submitted form; file inputs and repeated names are ignored. */
export function gateFormFields(formData: FormData): GateFormFields {
  const fields: Record<string, string> = {}
  for (const [name, value] of formData.entries()) {
    if (typeof value === 'string' && !Object.hasOwn(fields, name)) fields[name] = value
  }
  return fields
}

const toNumber = (raw: string) => (raw.trim() === '' ? Number.NaN : Number(raw.trim()))
const toOptionalNumber = (raw: string | undefined) =>
  raw === undefined || raw.trim() === '' ? undefined : Number(raw.trim())

function sourceRulesCandidate(fields: GateFormFields): unknown {
  return Object.fromEntries(
    SOURCES.map((source) => [
      source,
      {
        mode: fields[GATE_FIELD.ruleMode(source)],
        threshold: toOptionalNumber(fields[GATE_FIELD.ruleThreshold(source)]),
        minItemScore: toOptionalNumber(fields[GATE_FIELD.ruleMinItemScore(source)]),
      },
    ]),
  )
}

type Candidate = (fields: GateFormFields) => unknown

// gate_weights is still stored and parsed by core, but since gate-v2 it changes nothing, so no form writes it.
export type EditableGateSetting = Exclude<GateSettingName, 'weights'>

// Each setting is read only when its form field (or the first of its group) was submitted.
const CANDIDATES: { [Field in EditableGateSetting]: { present: string; candidate: Candidate } } = {
  mode: { present: GATE_FIELD.mode, candidate: (f) => f[GATE_FIELD.mode]?.trim() },
  threshold: {
    present: GATE_FIELD.threshold,
    candidate: (f) => toNumber(f[GATE_FIELD.threshold] ?? ''),
  },
  sourceRules: { present: GATE_FIELD.ruleMode(SOURCES[0]!), candidate: sourceRulesCandidate },
  instructions: {
    present: GATE_FIELD.instructions,
    candidate: (f) => f[GATE_FIELD.instructions]?.replace(/\r\n/g, '\n').trim(),
  },
  model: { present: GATE_FIELD.model, candidate: (f) => f[GATE_FIELD.model]?.trim() },
  effort: { present: GATE_FIELD.effort, candidate: (f) => f[GATE_FIELD.effort]?.trim() },
  exploreRate: {
    present: GATE_FIELD.exploreRatePercent,
    candidate: (f) => toNumber(f[GATE_FIELD.exploreRatePercent] ?? '') / PERCENT,
  },
  exampleCount: {
    present: GATE_FIELD.exampleCount,
    candidate: (f) => toNumber(f[GATE_FIELD.exampleCount] ?? ''),
  },
  performanceExamples: {
    present: GATE_FIELD.performanceExamples,
    candidate: (f) => toNumber(f[GATE_FIELD.performanceExamples] ?? ''),
  },
  maxCostUsdPerItem: {
    present: GATE_FIELD.maxCostUsdPerItem,
    candidate: (f) => toNumber(f[GATE_FIELD.maxCostUsdPerItem] ?? ''),
  },
}

function issueText(def: SettingDef<unknown>, issue: { path: PropertyKey[]; message: string }) {
  const where = issue.path.length ? ` (${issue.path.map(String).join('.')})` : ''
  return `${def.key}${where}: ${issue.message}`
}

/** Validates the gate settings present in a submitted form with the core schemas; the first invalid one fails the whole form. */
export function parseGateSettingsForm(fields: GateFormFields): ParsedGateForm<GateSettingsPatch> {
  const patch: Record<string, unknown> = {}
  for (const name of Object.keys(CANDIDATES) as EditableGateSetting[]) {
    const { present, candidate } = CANDIDATES[name]
    if (!Object.hasOwn(fields, present)) continue
    const def = GATE_SETTING_DEFS[name] as SettingDef<unknown>
    const parsed = def.schema.safeParse(candidate(fields))
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      return { ok: false, error: issue ? issueText(def, issue) : `${def.key}: invalid` }
    }
    patch[name] = parsed.data
  }
  if (Object.keys(patch).length === 0) return { ok: false, error: 'Nothing to save' }
  return { ok: true, value: patch as GateSettingsPatch }
}

export type GateTuningInput = { threshold: number }

/** The threshold typed into the tuning form, validated but not saved, for a dry run. */
export function parseGateTuningForm(fields: GateFormFields): ParsedGateForm<GateTuningInput> {
  const parsed = parseGateSettingsForm({
    [GATE_FIELD.threshold]: fields[GATE_FIELD.threshold] ?? '',
  })
  if (!parsed.ok) return parsed
  const { threshold } = parsed.value
  if (threshold === undefined) return { ok: false, error: 'gate_threshold: required' }
  return { ok: true, value: { threshold } }
}

/** Per-source threshold overrides, for re-scoring a decision against the threshold its source uses. */
export function sourceThresholds(rules: GateSourceRules): Partial<Record<string, number>> {
  return Object.fromEntries(
    Object.entries(rules).flatMap(([source, rule]) =>
      rule.threshold === undefined ? [] : [[source, rule.threshold]],
    ),
  )
}

/** Upper bound a numeric setting's schema enforces, read from the schema so form hints cannot drift from validation. */
export function gateSettingMax(name: GateSettingName): number {
  const schema = GATE_SETTING_DEFS[name].schema as { maxValue?: number | null }
  return schema.maxValue ?? Number.MAX_SAFE_INTEGER
}

/** Cost marks per model for the settings form, from core's gateCallBudget and gateCallCostUsd, so the page can warn as the admin types without importing core in the browser. */
export function gateCostMarks(instructionsChars: number): Record<string, CostMarks> {
  const fixedPromptChars = instructionsChars + GATE_PROMPT_OVERHEAD_CHARS
  return Object.fromEntries(
    CLAUDE_MODELS.map((model) => [
      model,
      {
        skipBelowUsd: gateCallBudget({ model, maxCostUsd: 0, fixedPromptChars }).minCostUsd,
        fullEvidenceFromUsd: gateCallCostUsd(model, fixedPromptChars + GATE_EVIDENCE_MAX_CHARS),
      },
    ]),
  )
}
