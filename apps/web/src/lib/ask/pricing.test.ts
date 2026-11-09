import { describe, expect, it } from 'vitest'
import { askSpendInput } from './pricing'

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
})
