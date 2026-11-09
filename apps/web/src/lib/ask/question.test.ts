import { describe, expect, it } from 'vitest'
import { normalizeQuestion, validateQuestion } from './question'

describe('normalizeQuestion', () => {
  it('lowercases, collapses whitespace and strips trailing punctuation', () => {
    expect(normalizeQuestion('  What  is\tRust? ')).toBe('what is rust')
    expect(normalizeQuestion('Why Postgres?!?')).toBe('why postgres')
  })

  it('maps equivalent unicode forms to the same key', () => {
    expect(normalizeQuestion('ＬＬＭ benchmarks')).toBe(normalizeQuestion('llm benchmarks'))
  })
})

describe('validateQuestion', () => {
  it('accepts 3..300 characters', () => {
    const ok = validateQuestion('  Is   Bun faster than Node?  ')
    expect(ok).toEqual({
      ok: true,
      question: 'Is Bun faster than Node?',
      normalized: 'is bun faster than node',
    })
    expect(validateQuestion('abc').ok).toBe(true)
    expect(validateQuestion('a'.repeat(300)).ok).toBe(true)
  })

  it('rejects too short, too long and non-strings', () => {
    expect(validateQuestion('ab')).toEqual({ ok: false, reason: 'too_short' })
    expect(validateQuestion('  a ')).toEqual({ ok: false, reason: 'too_short' })
    expect(validateQuestion('???')).toEqual({ ok: false, reason: 'too_short' })
    expect(validateQuestion('a'.repeat(301))).toEqual({ ok: false, reason: 'too_long' })
    expect(validateQuestion(42)).toEqual({ ok: false, reason: 'not_a_string' })
  })
})
