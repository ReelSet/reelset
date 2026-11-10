import { describe, expect, it } from 'vitest'
import { MAX_SPOKEN_CHARS, estimateSpeechSeconds, spokenChars } from './speech'

describe('spokenChars', () => {
  it('counts plain text and short numbers at face value', () => {
    expect(spokenChars('Postgres 17 adds 2.5x speed')).toBe('Postgres 17 adds 2.5x speed'.length)
  })

  it('weights long digit runs because they are read digit by digit', () => {
    const text = 'billing gets 0.9982666969299316 here'
    expect(spokenChars(text)).toBeGreaterThan(text.length + 30)
  })

  it('puts the HF decision-models narration (805 chars, 3 long decimals) over the cap', () => {
    const base = 'x'.repeat(805 - 62)
    const decimals = '0.9982666969299316 0.0010246571619063616 0.0007087149424478412'
    expect(`${base}${decimals}`.length).toBeLessThanOrEqual(805)
    expect(spokenChars(`${base} ${decimals}`)).toBeGreaterThan(MAX_SPOKEN_CHARS)
  })

  it('converts to seconds at the Aura rate', () => {
    expect(estimateSpeechSeconds('a'.repeat(142))).toBeCloseTo(10, 5)
  })
})
