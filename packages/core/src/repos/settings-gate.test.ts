import pino from 'pino'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_GATE_INSTRUCTIONS,
  DEFAULT_GATE_SOURCE_RULES,
  DEFAULT_GATE_WEIGHTS,
  GATE_INSTRUCTIONS_MAX_CHARS,
  GATE_SETTING_KEY_PREFIX,
} from '../domain/gate'
import { SETTINGS, parseSetting, settingEnumOptions } from './settings.repo'

const log = pino({ level: 'silent' })

describe('gate settings', () => {
  it('store under gate_ keys', () => {
    const keys = [
      SETTINGS.gateMode,
      SETTINGS.gateThreshold,
      SETTINGS.gateWeights,
      SETTINGS.gateSourceRules,
      SETTINGS.gateInstructions,
      SETTINGS.gateModel,
      SETTINGS.gateEffort,
      SETTINGS.gateExploreRate,
      SETTINGS.gateExampleCount,
      SETTINGS.gateMaxCostUsdPerItem,
    ].map((setting) => setting.key)
    expect(keys).toEqual([
      'gate_mode',
      'gate_threshold',
      'gate_weights',
      'gate_source_rules',
      'gate_instructions',
      'gate_model',
      'gate_effort',
      'gate_explore_rate',
      'gate_example_count',
      'gate_max_cost_usd_per_item',
    ])
    const prefixed = Object.values(SETTINGS).filter((s) =>
      s.key.startsWith(GATE_SETTING_KEY_PREFIX),
    )
    expect(prefixed).toHaveLength(keys.length)
  })

  it('default to shadow mode on Haiku at low effort', () => {
    expect(parseSetting(SETTINGS.gateMode, undefined, log)).toBe('shadow')
    expect(parseSetting(SETTINGS.gateThreshold, undefined, log)).toBe(55)
    expect(parseSetting(SETTINGS.gateWeights, undefined, log)).toEqual(DEFAULT_GATE_WEIGHTS)
    expect(parseSetting(SETTINGS.gateSourceRules, undefined, log)).toEqual(
      DEFAULT_GATE_SOURCE_RULES,
    )
    expect(parseSetting(SETTINGS.gateInstructions, undefined, log)).toBe(DEFAULT_GATE_INSTRUCTIONS)
    expect(parseSetting(SETTINGS.gateModel, undefined, log)).toBe('claude-haiku-5-5')
    expect(parseSetting(SETTINGS.gateEffort, undefined, log)).toBe('low')
    expect(parseSetting(SETTINGS.gateExploreRate, undefined, log)).toBe(0.05)
    expect(parseSetting(SETTINGS.gateExampleCount, undefined, log)).toBe(8)
    expect(parseSetting(SETTINGS.gateMaxCostUsdPerItem, undefined, log)).toBe(0.01)
  })

  it('has defaults that pass their own schema', () => {
    for (const setting of Object.values(SETTINGS)) {
      if (!setting.key.startsWith(GATE_SETTING_KEY_PREFIX)) continue
      expect(setting.schema.safeParse(setting.default).success, setting.key).toBe(true)
    }
  })

  it('accepts values inside the bounds', () => {
    expect(parseSetting(SETTINGS.gateMode, 'live', log)).toBe('live')
    expect(parseSetting(SETTINGS.gateMode, 'off', log)).toBe('off')
    expect(parseSetting(SETTINGS.gateThreshold, 0, log)).toBe(0)
    expect(parseSetting(SETTINGS.gateThreshold, 100, log)).toBe(100)
    expect(parseSetting(SETTINGS.gateExploreRate, 0, log)).toBe(0)
    expect(parseSetting(SETTINGS.gateExploreRate, 0.5, log)).toBe(0.5)
    expect(parseSetting(SETTINGS.gateExampleCount, 0, log)).toBe(0)
    expect(parseSetting(SETTINGS.gateExampleCount, 20, log)).toBe(20)
    expect(parseSetting(SETTINGS.gateEffort, 'high', log)).toBe('high')
    expect(parseSetting(SETTINGS.gateMaxCostUsdPerItem, 0.05, log)).toBe(0.05)
  })

  it('falls back to the default outside the bounds, so a bad admin edit cannot break ingest', () => {
    expect(parseSetting(SETTINGS.gateMode, 'on', log)).toBe('shadow')
    expect(parseSetting(SETTINGS.gateThreshold, 101, log)).toBe(55)
    expect(parseSetting(SETTINGS.gateThreshold, -1, log)).toBe(55)
    expect(parseSetting(SETTINGS.gateExploreRate, 0.51, log)).toBe(0.05)
    expect(parseSetting(SETTINGS.gateExampleCount, 21, log)).toBe(8)
    expect(parseSetting(SETTINGS.gateExampleCount, 2.5, log)).toBe(8)
    expect(parseSetting(SETTINGS.gateModel, 'claude-3-haiku', log)).toBe('claude-haiku-5-5')
    expect(parseSetting(SETTINGS.gateEffort, 'max', log)).toBe('low')
    expect(parseSetting(SETTINGS.gateMaxCostUsdPerItem, 0, log)).toBe(0.01)
    expect(parseSetting(SETTINGS.gateMaxCostUsdPerItem, 5, log)).toBe(0.01)
    expect(parseSetting(SETTINGS.gateInstructions, 'too short', log)).toBe(
      DEFAULT_GATE_INSTRUCTIONS,
    )
    expect(
      parseSetting(SETTINGS.gateInstructions, 'x'.repeat(GATE_INSTRUCTIONS_MAX_CHARS + 1), log),
    ).toBe(DEFAULT_GATE_INSTRUCTIONS)
  })

  it('fills in weights and source rules missing from a stored value', () => {
    expect(parseSetting(SETTINGS.gateWeights, { hook: 6, stakes: 0 }, log)).toEqual({
      ...DEFAULT_GATE_WEIGHTS,
      hook: 6,
      stakes: 0,
    })
    const rules = { youtube: { mode: 'always_reel' }, hn: { threshold: 70, minItemScore: 0.5 } }
    expect(parseSetting(SETTINGS.gateSourceRules, rules, log)).toEqual({
      ...DEFAULT_GATE_SOURCE_RULES,
      youtube: { mode: 'always_reel' },
      hn: { mode: 'judge', threshold: 70, minItemScore: 0.5 },
    })
  })

  it('falls back whole on invalid weights or source rules', () => {
    expect(parseSetting(SETTINGS.gateWeights, { hook: 99 }, log)).toEqual(DEFAULT_GATE_WEIGHTS)
    expect(parseSetting(SETTINGS.gateWeights, 'heavy', log)).toEqual(DEFAULT_GATE_WEIGHTS)
    expect(parseSetting(SETTINGS.gateSourceRules, { hn: { mode: 'skip' } }, log)).toEqual(
      DEFAULT_GATE_SOURCE_RULES,
    )
  })

  it('exposes the enum options the admin form needs', () => {
    expect(settingEnumOptions(SETTINGS.gateMode)).toEqual(['off', 'shadow', 'live'])
    expect(settingEnumOptions(SETTINGS.gateEffort)).toEqual(['low', 'medium', 'high'])
    expect(settingEnumOptions(SETTINGS.gateWeights)).toBeNull()
  })
})
