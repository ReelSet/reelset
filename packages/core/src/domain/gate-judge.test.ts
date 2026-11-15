import { describe, expect, it } from 'vitest'
import {
  GATE_EVIDENCE_MAX_CHARS,
  GATE_EVIDENCE_MIN_CHARS,
  GATE_PROMPT_OVERHEAD_CHARS,
  DEFAULT_GATE_INSTRUCTIONS,
  gateCallBudget,
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

  it('gives Sonnet a shorter excerpt that keeps the call under the cap', () => {
    const sonnet = budget('claude-sonnet-5-5')
    expect(sonnet.fits).toBe(true)
    expect(sonnet.evidenceChars).toBeGreaterThanOrEqual(GATE_EVIDENCE_MIN_CHARS)
    expect(sonnet.evidenceChars).toBeLessThan(GATE_EVIDENCE_MAX_CHARS)
    const cost = gateCallCostUsd('claude-sonnet-5-5', fixedPromptChars + sonnet.evidenceChars)
    expect(cost).toBeLessThanOrEqual(0.01)
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
