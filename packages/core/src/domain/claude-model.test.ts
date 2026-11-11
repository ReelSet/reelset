import { describe, expect, it } from 'vitest'
import { CLAUDE_MODELS, CLAUDE_PRICING, claudeCostUsd, claudeModelSchema } from './claude-model'

const MTOK = 1_000_000

describe('claudeModelSchema', () => {
  it('accepts only the supported model ids', () => {
    expect(claudeModelSchema.safeParse('claude-sonnet-5-5').success).toBe(true)
    expect(claudeModelSchema.safeParse('claude-sonnet-5').success).toBe(false)
    expect(claudeModelSchema.safeParse('gpt-5').success).toBe(false)
  })

  it('has a price for every model', () => {
    expect(Object.keys(CLAUDE_PRICING).sort()).toEqual([...CLAUDE_MODELS].sort())
  })
})

describe('claudeCostUsd', () => {
  it('keeps both Haiku 5.5 rate cards, switching above 100K prompt tokens', () => {
    expect(
      claudeCostUsd('claude-haiku-5-5', { inputTokens: MTOK / 100, outputTokens: 0 }),
    ).toBeCloseTo(0.001)
    expect(claudeCostUsd('claude-haiku-5-5', { inputTokens: 0, outputTokens: MTOK })).toBeCloseTo(
      0.5,
    )
    expect(
      claudeCostUsd('claude-haiku-5-5', { inputTokens: 200_000, outputTokens: MTOK }),
    ).toBeCloseTo(0.1 + 2.5)
  })

  it('counts cache tokens toward the Haiku long-prompt threshold', () => {
    const usage = { inputTokens: 1000, outputTokens: 0, cacheReadTokens: 100_000 }
    expect(claudeCostUsd('claude-haiku-5-5', usage)).toBeCloseTo(
      (1000 * 0.5 + 100_000 * 0.05) / MTOK,
    )
  })

  it('prices Haiku cache reads at 0.1x and writes at 1.25x of input', () => {
    const read = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 100_000 }
    const write = { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 100_000 }
    expect(claudeCostUsd('claude-haiku-5-5', read)).toBeCloseTo(0.001)
    expect(claudeCostUsd('claude-haiku-5-5', write)).toBeCloseTo(0.0125)
  })

  it('prices Sonnet 5.5 at $2/$10 with $0.10 cache reads and no long-prompt card', () => {
    expect(
      claudeCostUsd('claude-sonnet-5-5', { inputTokens: MTOK, outputTokens: MTOK }),
    ).toBeCloseTo(12)
    expect(
      claudeCostUsd('claude-sonnet-5-5', {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: MTOK,
      }),
    ).toBeCloseTo(0.1)
    expect(
      claudeCostUsd('claude-sonnet-5-5', {
        inputTokens: 0,
        outputTokens: 0,
        cacheWriteTokens: MTOK,
      }),
    ).toBeCloseTo(2.5)
  })

  it('prices Opus 5.5 at $4/$20 with $0.20 cache reads', () => {
    expect(claudeCostUsd('claude-opus-5-5', { inputTokens: MTOK, outputTokens: MTOK })).toBeCloseTo(
      24,
    )
    expect(
      claudeCostUsd('claude-opus-5-5', { inputTokens: 0, outputTokens: 0, cacheReadTokens: MTOK }),
    ).toBeCloseTo(0.2)
  })
})
