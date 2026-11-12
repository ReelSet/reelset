import { describe, expect, it } from 'vitest'
import {
  DIRECTOR_DEFAULT_REVIEW,
  DIRECTOR_DEFAULT_RULES,
  approxTokens,
  directorPayloadSchema,
  parseDirectorMeta,
} from './director'
import { SETTINGS } from '../repos/settings.repo'
import { claudeCostUsd } from './claude-model'

describe('director defaults', () => {
  it('fit the setting schemas', () => {
    expect(SETTINGS.directorRules.schema.safeParse(DIRECTOR_DEFAULT_RULES).success).toBe(true)
    expect(SETTINGS.directorReviewPrompt.schema.safeParse(DIRECTOR_DEFAULT_REVIEW).success).toBe(
      true,
    )
    expect(DIRECTOR_DEFAULT_REVIEW).toContain('```js')
  })
  it('settings bound max tokens and effort', () => {
    expect(SETTINGS.directorMaxTokens.schema.safeParse(1023).success).toBe(false)
    expect(SETTINGS.directorMaxTokens.schema.safeParse(128_001).success).toBe(false)
    expect(SETTINGS.directorEffort.schema.safeParse('max').success).toBe(true)
    expect(SETTINGS.directorEffort.schema.safeParse('ultra').success).toBe(false)
  })
})

describe('directorPayloadSchema', () => {
  const payload = {
    model: 'claude-haiku-5-5',
    effort: 'medium',
    maxTokens: 128000,
    review: true,
    rules: 'r',
    reviewPrompt: 'p',
    skills: [{ name: 'a', content: 'b' }],
    example: null,
  }
  it('accepts the contract shape', () => {
    expect(directorPayloadSchema.parse(payload)).toEqual(payload)
  })
  it('rejects oversized rules', () => {
    expect(directorPayloadSchema.safeParse({ ...payload, rules: 'x'.repeat(20_001) }).success).toBe(
      false,
    )
  })
})

describe('parseDirectorMeta', () => {
  it('parses a full report', () => {
    const meta = parseDirectorMeta({
      used: true,
      model: 'claude-haiku-5-5',
      scenes: 6,
      sceneErrors: 1,
      fallbackReason: null,
      inputTokens: 90000,
      outputTokens: 9000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      ms: 41000,
    })
    expect(meta).toMatchObject({ used: true, scenes: 6, sceneErrors: 1, ms: 41000 })
  })
  it('degrades garbage fields to safe defaults and rejects non-objects', () => {
    expect(parseDirectorMeta({ used: 'yes', scenes: -3, inputTokens: 'lots' })).toMatchObject({
      used: false,
      scenes: 0,
      inputTokens: 0,
      fallbackReason: null,
    })
    expect(parseDirectorMeta('nope')).toBeNull()
    expect(parseDirectorMeta(undefined)).toBeNull()
  })
})

describe('director price tier', () => {
  it('charges the long-prompt rates above 100K prompt tokens, counting cache tokens', () => {
    const short = claudeCostUsd('claude-haiku-5-5', { inputTokens: 100_000, outputTokens: 10_000 })
    expect(short).toBeCloseTo(0.1 * 0.1 + 10_000 * 0.5e-6, 6)
    const long = claudeCostUsd('claude-haiku-5-5', {
      inputTokens: 50_000,
      cacheReadTokens: 40_000,
      cacheWriteTokens: 10_001,
      outputTokens: 10_000,
    })
    expect(long).toBeCloseTo(
      50_000 * 0.5e-6 + 40_000 * 0.05e-6 + 10_001 * 0.625e-6 + 10_000 * 2.5e-6,
      6,
    )
  })
  it('estimates tokens at four chars each', () => {
    expect(approxTokens(400_000)).toBe(100_000)
  })
})
