import { describe, expect, it } from 'vitest'
import { codeMetrics, sliceTokens, tokenize } from './highlight'

describe('tokenize', () => {
  it('classifies keywords, strings, numbers, comments and calls and loses no text', () => {
    const code = 'const n = 42 // answer\nrun("x", `y`)'
    const tokens = tokenize(code)
    expect(tokens.map((t) => t.text).join('')).toBe(code)
    const kinds = Object.fromEntries(tokens.map((t) => [t.text, t.kind]))
    expect(kinds.const).toBe('keyword')
    expect(kinds['42']).toBe('number')
    expect(kinds['// answer']).toBe('comment')
    expect(kinds.run).toBe('call')
    expect(kinds['"x"']).toBe('string')
  })

  it('tolerates unterminated strings', () => {
    expect(
      tokenize('say("oops')
        .map((t) => t.text)
        .join(''),
    ).toBe('say("oops')
  })
})

describe('sliceTokens', () => {
  it('reveals exactly n characters across token boundaries', () => {
    const tokens = tokenize('let x = 1')
    for (const n of [0, 1, 4, 9, 20]) {
      expect(
        sliceTokens(tokens, n)
          .map((t) => t.text)
          .join(''),
      ).toBe('let x = 1'.slice(0, n))
    }
  })
})

describe('codeMetrics', () => {
  it('uses a large font for short code and wraps instead of shrinking below legibility', () => {
    expect(codeMetrics('a = 1', 500, 450).size).toBeGreaterThanOrEqual(28)
    const wide = codeMetrics('x'.repeat(120) + '\nshort', 500, 450)
    expect(wide.wrap).toBe(true)
    expect(wide.size).toBeGreaterThanOrEqual(15)
  })
})
