import type { GateLabel, GateVerdict } from '@reelset/core'
import { describe, expect, it } from 'vitest'
import {
  SUGGEST_MIN_LABELS,
  dryRunGate,
  suggestThreshold,
  type JudgedDecision,
} from './gate-tuning'

function scored(score: number, patch: Partial<JudgedDecision> = {}): JudgedDecision {
  return {
    score,
    threshold: 55,
    verdict: score >= 55 ? 'reel' : 'source_only',
    label: null,
    source: 'github',
    ...patch,
  }
}

const labelled = (score: number, correct: GateVerdict): JudgedDecision => {
  const decision = scored(score)
  const label: GateLabel = decision.verdict === correct ? 'agree' : 'disagree'
  return { ...decision, label }
}

describe('dryRunGate', () => {
  it('changes nothing at the threshold the decisions were made with', () => {
    expect(dryRunGate([scored(80), scored(60), scored(30)], { threshold: 55 })).toMatchObject({
      sample: 3,
      reelToSourceOnly: 0,
      sourceOnlyToReel: 0,
      reelsBefore: 2,
      reelsAfter: 2,
      labelled: 0,
    })
  })

  it('re-cuts the stored scores, counting flips in both directions', () => {
    const decisions = [scored(80), scored(60), scored(50), scored(30)]
    expect(dryRunGate(decisions, { threshold: 70 })).toMatchObject({
      reelToSourceOnly: 1,
      sourceOnlyToReel: 0,
      reelsBefore: 2,
      reelsAfter: 1,
    })
    expect(dryRunGate(decisions, { threshold: 45 })).toMatchObject({
      reelToSourceOnly: 0,
      sourceOnlyToReel: 1,
      reelsAfter: 3,
    })
  })

  it('treats a score exactly at the threshold as a reel', () => {
    expect(dryRunGate([scored(60)], { threshold: 60 }).reelsAfter).toBe(1)
    expect(dryRunGate([scored(60)], { threshold: 60.5 }).reelsAfter).toBe(0)
  })

  it('scores the change against admin labels', () => {
    const decisions = [
      labelled(60, 'source_only'),
      labelled(60, 'reel'),
      labelled(30, 'source_only'),
      scored(60),
    ]
    expect(dryRunGate(decisions, { threshold: 70 })).toMatchObject({
      labelled: 3,
      matchedBefore: 2,
      matchedAfter: 2,
    })
    expect(dryRunGate(decisions, { threshold: 20 })).toMatchObject({
      labelled: 3,
      matchedBefore: 2,
      matchedAfter: 1,
    })
  })

  it('treats an explore row by what the judge said, and its label by the stored verdict', () => {
    const explored = scored(40, { verdict: 'reel', label: 'agree' })
    expect(dryRunGate([explored], { threshold: 55 })).toMatchObject({
      reelsBefore: 0,
      reelsAfter: 0,
      labelled: 1,
      matchedBefore: 0,
      matchedAfter: 0,
    })
    expect(dryRunGate([explored], { threshold: 30 })).toMatchObject({
      sourceOnlyToReel: 1,
      matchedAfter: 1,
    })
  })

  it('counts a disagreed explore row as the judge having been right', () => {
    const explored = scored(40, { verdict: 'reel', label: 'disagree' })
    expect(dryRunGate([explored], { threshold: 55 })).toMatchObject({
      labelled: 1,
      matchedBefore: 1,
      matchedAfter: 1,
    })
    expect(dryRunGate([explored], { threshold: 30 })).toMatchObject({
      matchedBefore: 1,
      matchedAfter: 0,
    })
  })

  it('uses a per-source threshold override where one is set', () => {
    const result = dryRunGate([scored(60, { source: 'papers' }), scored(60)], {
      threshold: 55,
      sourceThresholds: { papers: 80 },
    })
    expect(result).toMatchObject({ reelToSourceOnly: 1, reelsAfter: 1 })
  })

  it('reports an empty sample', () => {
    expect(dryRunGate([], { threshold: 55 })).toMatchObject({ sample: 0, labelled: 0 })
  })
})

describe('suggestThreshold', () => {
  const many = (count: number, score: number, correct: GateVerdict) =>
    Array.from({ length: count }, () => labelled(score, correct))

  it('says nothing below the minimum number of labels', () => {
    const few = [...many(SUGGEST_MIN_LABELS - 4, 80, 'reel'), ...many(3, 20, 'source_only')]
    expect(suggestThreshold(few, 55)).toBeNull()
  })

  it('says nothing when one side has almost no labels', () => {
    expect(
      suggestThreshold([...many(30, 80, 'reel'), ...many(2, 20, 'source_only')], 55),
    ).toBeNull()
  })

  it('finds the threshold that separates the labels and reports how it compares', () => {
    const decisions = [
      ...many(10, 80, 'reel'),
      ...many(6, 60, 'source_only'),
      ...many(10, 30, 'source_only'),
    ]
    expect(suggestThreshold(decisions, 55)).toEqual({
      threshold: 61,
      matches: 26,
      currentMatches: 20,
      sample: 26,
    })
  })

  it('keeps the current threshold when nothing beats it', () => {
    const suggestion = suggestThreshold(
      [...many(12, 80, 'reel'), ...many(12, 30, 'source_only')],
      55,
    )!
    expect(suggestion.threshold).toBe(55)
    expect(suggestion.matches).toBe(suggestion.currentMatches)
  })

  it('reads explore labels by the outcome they are about', () => {
    const agreedExplores = Array.from({ length: 6 }, () =>
      scored(50, { verdict: 'reel', label: 'agree' }),
    )
    const decisions = [...many(10, 80, 'reel'), ...agreedExplores, ...many(10, 30, 'source_only')]
    expect(suggestThreshold(decisions, 55)).toMatchObject({
      threshold: 50,
      matches: 26,
      currentMatches: 20,
    })
  })

  it('ignores unlabelled decisions', () => {
    const decisions = [...many(12, 80, 'reel'), ...many(12, 30, 'source_only'), scored(60)]
    expect(suggestThreshold(decisions, 55)!.sample).toBe(24)
  })
})
