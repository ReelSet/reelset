import { DEFAULT_GATE_WEIGHTS, type GateLabel, type GateVerdict } from '@reelset/core'
import { describe, expect, it } from 'vitest'
import {
  SUGGEST_MIN_LABELS,
  dryRunGate,
  suggestThreshold,
  type JudgedDecision,
} from './gate-tuning'

const WEIGHTS = DEFAULT_GATE_WEIGHTS
const ALL_SIGNALS = ['hook', 'visual', 'novelty', 'audience', 'clarity', 'stakes'] as const

// Every signal at the same mark, so the score is mark x 10 under any weights.
function flat(mark: number, patch: Partial<JudgedDecision> = {}): JudgedDecision {
  const score = mark * 10
  return {
    signals: Object.fromEntries(ALL_SIGNALS.map((key) => [key, mark])),
    score,
    threshold: 55,
    verdict: score >= 55 ? 'reel' : 'source_only',
    label: null,
    source: 'github',
    ...patch,
  }
}

const labelled = (mark: number, correct: GateVerdict): JudgedDecision => {
  const decision = flat(mark)
  const label: GateLabel = decision.verdict === correct ? 'agree' : 'disagree'
  return { ...decision, label }
}

describe('dryRunGate', () => {
  it('changes nothing when the settings are the ones the decisions were made with', () => {
    const result = dryRunGate([flat(8), flat(6), flat(3)], { threshold: 55, weights: WEIGHTS })
    expect(result).toMatchObject({
      sample: 3,
      reelToSourceOnly: 0,
      sourceOnlyToReel: 0,
      reelsBefore: 2,
      reelsAfter: 2,
      labelled: 0,
    })
  })

  it('counts flips in both directions when the threshold moves', () => {
    const decisions = [flat(8), flat(6), flat(5), flat(3)]
    expect(dryRunGate(decisions, { threshold: 70, weights: WEIGHTS })).toMatchObject({
      reelToSourceOnly: 1,
      sourceOnlyToReel: 0,
      reelsBefore: 2,
      reelsAfter: 1,
    })
    expect(dryRunGate(decisions, { threshold: 45, weights: WEIGHTS })).toMatchObject({
      reelToSourceOnly: 0,
      sourceOnlyToReel: 1,
      reelsAfter: 3,
    })
  })

  it('re-scores with the new weights instead of trusting the stored score', () => {
    const hookOnly: JudgedDecision = {
      signals: { hook: 10, visual: 0, novelty: 0, audience: 0, clarity: 0, stakes: 0 },
      score: 25,
      threshold: 55,
      verdict: 'source_only',
      label: null,
      source: 'hn',
    }
    const weights = { hook: 10, visual: 0, novelty: 0, audience: 0, clarity: 0, stakes: 0 }
    expect(dryRunGate([hookOnly], { threshold: 55, weights })).toMatchObject({
      sourceOnlyToReel: 1,
      reelsAfter: 1,
    })
  })

  it('scores the change against admin labels', () => {
    const decisions = [
      labelled(6, 'source_only'),
      labelled(6, 'reel'),
      labelled(3, 'source_only'),
      flat(6),
    ]
    const result = dryRunGate(decisions, { threshold: 70, weights: WEIGHTS })
    expect(result).toMatchObject({ labelled: 3, matchedBefore: 2, matchedAfter: 2 })
    const looser = dryRunGate(decisions, { threshold: 20, weights: WEIGHTS })
    expect(looser).toMatchObject({ labelled: 3, matchedBefore: 2, matchedAfter: 1 })
  })

  it('treats an explore row by what the judge said, and its label by the stored verdict', () => {
    const explored = flat(4, { verdict: 'reel', label: 'agree' })
    const result = dryRunGate([explored], { threshold: 55, weights: WEIGHTS })
    expect(result).toMatchObject({
      reelsBefore: 0,
      reelsAfter: 0,
      labelled: 1,
      matchedBefore: 0,
      matchedAfter: 0,
    })
    expect(dryRunGate([explored], { threshold: 30, weights: WEIGHTS })).toMatchObject({
      sourceOnlyToReel: 1,
      matchedAfter: 1,
    })
  })

  it('counts a disagreed explore row as the judge having been right', () => {
    const explored = flat(4, { verdict: 'reel', label: 'disagree' })
    expect(dryRunGate([explored], { threshold: 55, weights: WEIGHTS })).toMatchObject({
      labelled: 1,
      matchedBefore: 1,
      matchedAfter: 1,
    })
    expect(dryRunGate([explored], { threshold: 30, weights: WEIGHTS })).toMatchObject({
      matchedBefore: 1,
      matchedAfter: 0,
    })
  })

  it('uses a per-source threshold override where one is set', () => {
    const result = dryRunGate([flat(6, { source: 'papers' }), flat(6)], {
      threshold: 55,
      weights: WEIGHTS,
      sourceThresholds: { papers: 80 },
    })
    expect(result).toMatchObject({ reelToSourceOnly: 1, reelsAfter: 1 })
  })

  it('leaves out decisions that carry no signals', () => {
    const ruleLike = flat(8, { signals: {} })
    expect(dryRunGate([ruleLike], { threshold: 55, weights: WEIGHTS }).sample).toBe(0)
  })
})

describe('suggestThreshold', () => {
  const many = (count: number, mark: number, correct: GateVerdict) =>
    Array.from({ length: count }, () => labelled(mark, correct))

  it('says nothing below the minimum number of labels', () => {
    const few = [...many(SUGGEST_MIN_LABELS - 4, 8, 'reel'), ...many(3, 2, 'source_only')]
    expect(suggestThreshold(few, WEIGHTS, 55)).toBeNull()
  })

  it('says nothing when one side has almost no labels', () => {
    const lopsided = [...many(30, 8, 'reel'), ...many(2, 2, 'source_only')]
    expect(suggestThreshold(lopsided, WEIGHTS, 55)).toBeNull()
  })

  it('finds the threshold that separates the labels and reports how it compares', () => {
    const decisions = [
      ...many(10, 8, 'reel'),
      ...many(6, 6, 'source_only'),
      ...many(10, 3, 'source_only'),
    ]
    const suggestion = suggestThreshold(decisions, WEIGHTS, 55)!
    expect(suggestion.sample).toBe(26)
    expect(suggestion.currentMatches).toBe(20)
    expect(suggestion.matches).toBe(26)
    expect(suggestion.threshold).toBe(61)
  })

  it('keeps the current threshold when nothing beats it', () => {
    const decisions = [...many(12, 8, 'reel'), ...many(12, 3, 'source_only')]
    const suggestion = suggestThreshold(decisions, WEIGHTS, 55)!
    expect(suggestion.threshold).toBe(55)
    expect(suggestion.matches).toBe(suggestion.currentMatches)
  })

  it('reads explore labels by the outcome they are about', () => {
    const agreedExplores = Array.from({ length: 6 }, () =>
      flat(5, { verdict: 'reel', label: 'agree' }),
    )
    const decisions = [...many(10, 8, 'reel'), ...agreedExplores, ...many(10, 3, 'source_only')]
    const suggestion = suggestThreshold(decisions, WEIGHTS, 55)!
    expect(suggestion.currentMatches).toBe(20)
    expect(suggestion.matches).toBe(26)
    expect(suggestion.threshold).toBe(50)
  })

  it('ignores unlabelled decisions', () => {
    const decisions = [...many(12, 8, 'reel'), ...many(12, 3, 'source_only'), flat(6), flat(6)]
    expect(suggestThreshold(decisions, WEIGHTS, 55)!.sample).toBe(24)
  })
})
