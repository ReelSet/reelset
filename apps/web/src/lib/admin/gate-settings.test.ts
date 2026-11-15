import {
  CLAUDE_MODELS,
  GATE_EVIDENCE_MAX_CHARS,
  GATE_PROMPT_OVERHEAD_CHARS,
  gateCallBudget,
  DEFAULT_GATE_SOURCE_RULES,
  DEFAULT_GATE_WEIGHTS,
  GATE_SETTING_KEY_PREFIX,
  SETTINGS,
  SOURCES,
} from '@reelset/core'
import { describe, expect, it } from 'vitest'
import { GATE_FIELD, costCapWarning } from './gate-fields'
import {
  GATE_SETTING_DEFS,
  gateCostMarks,
  gateFormFields,
  gateSettingMax,
  isGateSettingDefault,
  isGateSettingName,
  parseGateSettingsForm,
  parseGateTuningForm,
  sourceThresholds,
} from './gate-settings'

const weightFields = (value: string) =>
  Object.fromEntries(
    Object.keys(DEFAULT_GATE_WEIGHTS).map((key) => [GATE_FIELD.weight(key), value]),
  )

const ruleFields = (mode: string) =>
  Object.fromEntries(SOURCES.map((source) => [GATE_FIELD.ruleMode(source), mode]))

describe('GATE_SETTING_DEFS', () => {
  it('covers every gate_ setting in core, so none is left without an editor', () => {
    const gateKeys = Object.values(SETTINGS)
      .map((def) => def.key)
      .filter((key) => key.startsWith(GATE_SETTING_KEY_PREFIX))
    expect(
      Object.values(GATE_SETTING_DEFS)
        .map((def) => def.key)
        .sort(),
    ).toEqual(gateKeys.sort())
  })

  it('reads numeric limits from the core schemas', () => {
    expect(gateSettingMax('exploreRate')).toBe(0.5)
    expect(gateSettingMax('exampleCount')).toBe(20)
    expect(gateSettingMax('maxCostUsdPerItem')).toBe(1)
  })

  it('knows its own names only', () => {
    expect(isGateSettingName('threshold')).toBe(true)
    expect(isGateSettingName('toString')).toBe(false)
    expect(isGateSettingName(null)).toBe(false)
  })

  it('recognises default values regardless of where they came from', () => {
    expect(isGateSettingDefault('weights', { ...DEFAULT_GATE_WEIGHTS })).toBe(true)
    expect(isGateSettingDefault('weights', { ...DEFAULT_GATE_WEIGHTS, hook: 9 })).toBe(false)
    expect(isGateSettingDefault('sourceRules', DEFAULT_GATE_SOURCE_RULES)).toBe(true)
  })
})

describe('parseGateSettingsForm', () => {
  it('saves only the settings whose fields were submitted', () => {
    const parsed = parseGateSettingsForm({ [GATE_FIELD.mode]: 'live', returnTo: '/admin' })
    expect(parsed).toEqual({ ok: true, value: { mode: 'live' } })
  })

  it('parses threshold and weights together', () => {
    const parsed = parseGateSettingsForm({ [GATE_FIELD.threshold]: ' 62.5 ', ...weightFields('2') })
    expect(parsed).toEqual({
      ok: true,
      value: {
        threshold: 62.5,
        weights: { hook: 2, visual: 2, novelty: 2, audience: 2, clarity: 2, stakes: 2 },
      },
    })
  })

  it('rejects an out-of-range threshold, a blank number and all-zero weights', () => {
    expect(parseGateSettingsForm({ [GATE_FIELD.threshold]: '101' })).toMatchObject({ ok: false })
    expect(parseGateSettingsForm({ [GATE_FIELD.threshold]: '' })).toMatchObject({ ok: false })
    const zero = parseGateSettingsForm(weightFields('0'))
    expect(zero).toMatchObject({ ok: false })
    expect(zero.ok ? '' : zero.error).toContain('gate_weights')
  })

  it('names the weight that is wrong', () => {
    const parsed = parseGateSettingsForm({
      ...weightFields('2'),
      [GATE_FIELD.weight('hook')]: '11',
    })
    expect(parsed.ok ? '' : parsed.error).toContain('hook')
  })

  it('builds per-source rules with optional overrides', () => {
    const parsed = parseGateSettingsForm({
      ...ruleFields('judge'),
      [GATE_FIELD.ruleMode('papers')]: 'always_source_only',
      [GATE_FIELD.ruleThreshold('github')]: '70',
      [GATE_FIELD.ruleMinItemScore('hn')]: '0.4',
      [GATE_FIELD.ruleThreshold('news')]: '',
    })
    if (!parsed.ok) throw new Error(parsed.error)
    const rules = parsed.value.sourceRules!
    expect(rules.papers.mode).toBe('always_source_only')
    expect(rules.github).toMatchObject({ mode: 'judge', threshold: 70 })
    expect(rules.hn.minItemScore).toBe(0.4)
    expect(rules.news.threshold).toBeUndefined()
    expect(sourceThresholds(rules)).toEqual({ github: 70 })
  })

  it('rejects an unknown rule mode and an out-of-range minimum score', () => {
    expect(parseGateSettingsForm(ruleFields('sometimes'))).toMatchObject({ ok: false })
    expect(
      parseGateSettingsForm({ ...ruleFields('judge'), [GATE_FIELD.ruleMinItemScore('hn')]: '2' }),
    ).toMatchObject({ ok: false })
  })

  it('normalises line endings in the instructions and enforces their length', () => {
    const text = `${'Judge the source. '.repeat(10)}\r\nBe strict.`
    const parsed = parseGateSettingsForm({ [GATE_FIELD.instructions]: `  ${text}  ` })
    expect(parsed).toEqual({ ok: true, value: { instructions: text.replace('\r\n', '\n') } })
    expect(parseGateSettingsForm({ [GATE_FIELD.instructions]: 'too short' })).toMatchObject({
      ok: false,
    })
  })

  it('takes the explore rate as a percent', () => {
    expect(parseGateSettingsForm({ [GATE_FIELD.exploreRatePercent]: '5' })).toEqual({
      ok: true,
      value: { exploreRate: 0.05 },
    })
    expect(parseGateSettingsForm({ [GATE_FIELD.exploreRatePercent]: '60' })).toMatchObject({
      ok: false,
    })
  })

  it('validates the judge controls', () => {
    expect(
      parseGateSettingsForm({
        [GATE_FIELD.model]: SETTINGS.gateModel.default,
        [GATE_FIELD.effort]: 'high',
        [GATE_FIELD.exampleCount]: '12',
        [GATE_FIELD.maxCostUsdPerItem]: '0.02',
      }),
    ).toEqual({
      ok: true,
      value: {
        model: SETTINGS.gateModel.default,
        effort: 'high',
        exampleCount: 12,
        maxCostUsdPerItem: 0.02,
      },
    })
    expect(parseGateSettingsForm({ [GATE_FIELD.model]: 'gpt-9' })).toMatchObject({ ok: false })
    expect(parseGateSettingsForm({ [GATE_FIELD.exampleCount]: '2.5' })).toMatchObject({ ok: false })
    expect(parseGateSettingsForm({ [GATE_FIELD.maxCostUsdPerItem]: '0' })).toMatchObject({
      ok: false,
    })
  })

  it('refuses a form with no gate field', () => {
    expect(parseGateSettingsForm({ returnTo: '/admin' })).toEqual({
      ok: false,
      error: 'Nothing to save',
    })
  })
})

describe('parseGateTuningForm', () => {
  it('needs both the threshold and every weight', () => {
    expect(parseGateTuningForm({ [GATE_FIELD.threshold]: '50', ...weightFields('1') })).toEqual({
      ok: true,
      value: {
        threshold: 50,
        weights: { hook: 1, visual: 1, novelty: 1, audience: 1, clarity: 1, stakes: 1 },
      },
    })
    expect(parseGateTuningForm({ [GATE_FIELD.threshold]: '50' })).toMatchObject({ ok: false })
    expect(parseGateTuningForm(weightFields('1'))).toMatchObject({ ok: false })
  })
})

describe('gateFormFields', () => {
  it('keeps the first string value per field and drops files', () => {
    const formData = new FormData()
    formData.append('mode', 'live')
    formData.append('mode', 'off')
    formData.append('upload', new Blob(['x']))
    expect(gateFormFields(formData)).toEqual({ mode: 'live' })
  })
})

describe('cost cap versus model', () => {
  const INSTRUCTIONS_CHARS = 2400
  const marks = gateCostMarks(INSTRUCTIONS_CHARS)
  const fixedPromptChars = INSTRUCTIONS_CHARS + GATE_PROMPT_OVERHEAD_CHARS

  it('has marks for every model, dearer models higher', () => {
    expect(Object.keys(marks).sort()).toEqual([...CLAUDE_MODELS].sort())
    for (const model of CLAUDE_MODELS) {
      expect(marks[model]!.skipBelowUsd).toBeLessThan(marks[model]!.fullEvidenceFromUsd)
    }
    expect(marks['claude-haiku-5-5']!.skipBelowUsd).toBeLessThan(
      marks['claude-opus-5-5']!.skipBelowUsd,
    )
  })

  it('warns exactly when core says the call does not fit or gets less evidence', () => {
    for (const model of CLAUDE_MODELS) {
      const { skipBelowUsd, fullEvidenceFromUsd } = marks[model]!
      const caps = [
        skipBelowUsd * 0.5,
        skipBelowUsd * 0.99,
        skipBelowUsd * 1.01,
        (skipBelowUsd + fullEvidenceFromUsd) / 2,
        fullEvidenceFromUsd * 0.99,
        fullEvidenceFromUsd * 1.01,
        fullEvidenceFromUsd * 3,
      ]
      for (const maxCostUsd of caps) {
        const budget = gateCallBudget({ model, maxCostUsd, fixedPromptChars })
        const warning = costCapWarning(marks[model], maxCostUsd)
        const where = `${model} at $${maxCostUsd}`
        if (!budget.fits) expect(warning, where).toContain('will be skipped')
        else if (budget.evidenceChars < GATE_EVIDENCE_MAX_CHARS) {
          expect(warning, where).toContain('shorter excerpt')
        } else expect(warning, where).toBeNull()
      }
    }
  })

  it('longer instructions raise the marks', () => {
    const longer = gateCostMarks(INSTRUCTIONS_CHARS * 3)
    expect(longer['claude-sonnet-5-5']!.skipBelowUsd).toBeGreaterThan(
      marks['claude-sonnet-5-5']!.skipBelowUsd,
    )
  })

  it('says nothing for an unknown model or a cap that is not a usable number', () => {
    expect(costCapWarning(undefined, 0.01)).toBeNull()
    expect(costCapWarning(marks['claude-opus-5-5'], Number.NaN)).toBeNull()
    expect(costCapWarning(marks['claude-opus-5-5'], 0)).toBeNull()
  })
})
