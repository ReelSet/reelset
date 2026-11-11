import { describe, expect, it } from 'vitest'
import { askSpendInput, embeddingCostUsd, llmCostUsd } from './pricing'

describe('llmCostUsd', () => {
  it('uses Haiku 5.5 rates for prompts up to 100K tokens', () => {
    expect(llmCostUsd('claude-haiku-5-5', 100_000, 0)).toBeCloseTo(0.01)
    expect(llmCostUsd('claude-haiku-5-5', 0, 1_000_000)).toBeCloseTo(0.5)
    expect(llmCostUsd('claude-haiku-5-5', 2000, 300)).toBeCloseTo(0.00035)
  })

  it('switches to the large-prompt rates above 100K input tokens', () => {
    expect(llmCostUsd('claude-haiku-5-5', 200_000, 1000)).toBeCloseTo(0.1 + 0.0025)
  })

  it('follows the selected model', () => {
    expect(llmCostUsd('claude-sonnet-5-5', 2000, 300)).toBeCloseTo((2000 * 2 + 300 * 10) / 1e6)
    expect(llmCostUsd('claude-opus-5-5', 2000, 300)).toBeCloseTo((2000 * 4 + 300 * 20) / 1e6)
  })
})

describe('embeddingCostUsd', () => {
  it('prices gemini-embedding-001 input tokens', () => {
    expect(embeddingCostUsd(1_000_000)).toBeCloseTo(0.15)
  })
})

describe('askSpendInput', () => {
  it('books Ask spend under its own category so the pipeline cap never counts it', () => {
    expect(askSpendInput('llm', 120, 0.001)).toEqual({
      category: 'ask',
      units: 120,
      costUsd: 0.001,
      meta: { kind: 'llm' },
    })
    expect(askSpendInput('embedding', 40, 0.0001).category).toBe('ask')
  })

  it('records the answer model in meta', () => {
    expect(askSpendInput('llm', 120, 0.001, 'claude-opus-5-5').meta).toEqual({
      kind: 'llm',
      model: 'claude-opus-5-5',
    })
  })
})
