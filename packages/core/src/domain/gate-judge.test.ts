import { describe, expect, it } from 'vitest'
import { GATE_V1_DEFAULT_INSTRUCTIONS, GATE_V2_DEFAULT_INSTRUCTIONS } from './gate-legacy'
import {
  GATE_EVIDENCE_MAX_CHARS,
  GATE_EVIDENCE_MIN_CHARS,
  GATE_PROMPT_OVERHEAD_CHARS,
  DEFAULT_GATE_INSTRUCTIONS,
  DEFAULT_GATE_SOURCE_RULES,
  DEFAULT_GATE_WEIGHTS,
  GATE_INSTRUCTIONS_MAX_CHARS,
  currentGateInstructions,
  gateCallBudget,
  gateConfigHash,
  isSupersededGateInstructions,
  gateCallCostUsd,
  judgeVerdict,
  judgeWasRight,
} from './gate'

describe('judgeVerdict', () => {
  it('is the stored verdict unless the row was explored', () => {
    expect(judgeVerdict({ verdict: 'reel', decidedBy: 'model' })).toBe('reel')
    expect(judgeVerdict({ verdict: 'source_only', decidedBy: 'model' })).toBe('source_only')
    expect(judgeVerdict({ verdict: 'reel', decidedBy: 'rule' })).toBe('reel')
    expect(judgeVerdict({ verdict: 'reel', decidedBy: 'explore' })).toBe('source_only')
  })
})

describe('judgeWasRight', () => {
  it('follows the label on an ordinary row', () => {
    expect(judgeWasRight({ verdict: 'reel', decidedBy: 'model', label: 'agree' })).toBe(true)
    expect(judgeWasRight({ verdict: 'reel', decidedBy: 'model', label: 'disagree' })).toBe(false)
    expect(judgeWasRight({ verdict: 'source_only', decidedBy: 'model', label: 'agree' })).toBe(true)
  })

  it('inverts on an explore row, where the label is about the reel the judge did not want', () => {
    expect(judgeWasRight({ verdict: 'reel', decidedBy: 'explore', label: 'agree' })).toBe(false)
    expect(judgeWasRight({ verdict: 'reel', decidedBy: 'explore', label: 'disagree' })).toBe(true)
  })
})

describe('gateCallBudget', () => {
  const fixedPromptChars = DEFAULT_GATE_INSTRUCTIONS.length + GATE_PROMPT_OVERHEAD_CHARS
  const budget = (model: Parameters<typeof gateCallBudget>[0]['model'], maxCostUsd = 0.01) =>
    gateCallBudget({ model, maxCostUsd, fixedPromptChars })

  it('gives Haiku the full excerpt under the default cap', () => {
    const haiku = budget('claude-haiku-5-5')
    expect(haiku.fits).toBe(true)
    expect(haiku.evidenceChars).toBe(GATE_EVIDENCE_MAX_CHARS)
    expect(haiku.minCostUsd).toBeLessThan(0.001)
  })

  it('gives Sonnet a shorter excerpt that keeps the call under a slightly higher cap', () => {
    expect(budget('claude-sonnet-5-5').fits).toBe(false)
    const sonnet = budget('claude-sonnet-5-5', 0.012)
    expect(sonnet.fits).toBe(true)
    expect(sonnet.evidenceChars).toBeGreaterThanOrEqual(GATE_EVIDENCE_MIN_CHARS)
    expect(sonnet.evidenceChars).toBeLessThan(GATE_EVIDENCE_MAX_CHARS)
    const cost = gateCallCostUsd('claude-sonnet-5-5', fixedPromptChars + sonnet.evidenceChars)
    expect(cost).toBeLessThanOrEqual(0.012)
  })

  it('says Opus does not fit the default cap, and fits a larger one', () => {
    const opus = budget('claude-opus-5-5')
    expect(opus).toMatchObject({ fits: false, evidenceChars: 0 })
    expect(opus.minCostUsd).toBeGreaterThan(0.01)
    expect(budget('claude-opus-5-5', 0.05).fits).toBe(true)
  })

  it('never fits a cap that is not a positive number', () => {
    expect(budget('claude-haiku-5-5', 0).fits).toBe(false)
    expect(budget('claude-haiku-5-5', Number.NaN).fits).toBe(false)
  })
})

describe('gate-v3 defaults', () => {
  it('rates story: surprise, stake, material and trust, with hard ceilings', () => {
    for (const phrase of ['The surprise', 'The story', 'The material', 'Hard ceilings', 'a lure'])
      expect(DEFAULT_GATE_INSTRUCTIONS).toContain(phrase)
  })

  it('treats an untouched saved copy of the v2 default as superseded', () => {
    expect(isSupersededGateInstructions(GATE_V2_DEFAULT_INSTRUCTIONS)).toBe(true)
    expect(currentGateInstructions(GATE_V2_DEFAULT_INSTRUCTIONS)).toBe(DEFAULT_GATE_INSTRUCTIONS)
  })

  it('rates engagement: big names, drama and memes high, and does not punish unverified threads', () => {
    for (const phrase of [
      'Jensen Huang',
      'Memes and jokes',
      'Drama',
      'NOT a reason for a low rating',
    ])
      expect(DEFAULT_GATE_INSTRUCTIONS).toContain(phrase)
    expect(DEFAULT_GATE_INSTRUCTIONS).toContain('Do not rate truth, usefulness')
    expect(DEFAULT_GATE_INSTRUCTIONS.length).toBeLessThan(GATE_INSTRUCTIONS_MAX_CHARS)
  })

  it('treats an untouched saved copy of the v1 default as superseded, whitespace aside', () => {
    const saved = GATE_V1_DEFAULT_INSTRUCTIONS.replace(/\n/g, '\r\n') + '\n'
    expect(isSupersededGateInstructions(saved)).toBe(true)
    expect(currentGateInstructions(saved)).toBe(DEFAULT_GATE_INSTRUCTIONS)
    const edited = `${GATE_V1_DEFAULT_INSTRUCTIONS}\nAlso: no crypto.`
    expect(currentGateInstructions(edited)).toBe(edited)
    expect(isSupersededGateInstructions(DEFAULT_GATE_INSTRUCTIONS)).toBe(false)
  })

  it('leaves the legacy weights out of the config hash', async () => {
    const config = {
      mode: 'shadow',
      threshold: 55,
      weights: DEFAULT_GATE_WEIGHTS,
      sourceRules: DEFAULT_GATE_SOURCE_RULES,
      instructions: DEFAULT_GATE_INSTRUCTIONS,
      model: 'claude-haiku-5-5',
      effort: 'low',
      exploreRate: 0.05,
      exampleCount: 8,
      performanceExamples: 8,
      maxCostUsdPerItem: 0.01,
    } as const
    const reweighted = { ...config, weights: { ...DEFAULT_GATE_WEIGHTS, hook: 9 } }
    expect(await gateConfigHash(reweighted)).toBe(await gateConfigHash(config))
  })
})
