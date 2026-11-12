import { describe, expect, it } from 'vitest'
import { latexToText } from './latex'

const one = (s: string) => latexToText(s).join(' | ')

describe('latexToText', () => {
  it('turns fractions into slashes, parenthesising only compound sides', () => {
    expect(one('\\frac{a}{b}')).toBe('a/b')
    expect(one('\\frac{a+b}{c}')).toBe('(a + b)/c')
  })

  it('maps greek letters and operators', () => {
    expect(one('\\alpha \\cdot \\beta \\leq \\infty')).toBe('α · β ≤ ∞')
  })

  it('uses unicode scripts when it can and falls back to caret/underscore', () => {
    expect(one('x^2 + y_1')).toBe('x² + y₁')
    expect(one('e^{x+1}')).toBe('e^(x + 1)')
    expect(one('a_{ij}')).toBe('aᵢⱼ')
  })

  it('keeps summation limits readable', () => {
    expect(one('\\sum_{i=1}^{n} x_i')).toBe('Σ(i = 1…n) xᵢ')
  })

  it('handles sqrt, text and left/right', () => {
    expect(one('\\sqrt{d_k}')).toBe('√dₖ')
    expect(one('\\text{softmax}\\left(\\frac{QK^T}{\\sqrt{d_k}}\\right)V')).toBe(
      'softmax(QKᵀ/√dₖ)V',
    )
  })

  it('splits aligned rows on \\\\ and drops environments', () => {
    expect(latexToText('\\begin{aligned} a &= b \\\\ c &= d \\end{aligned}')).toEqual([
      'a = b',
      'c = d',
    ])
  })

  it('never throws on junk', () => {
    expect(() => latexToText('\\frac{')).not.toThrow()
    expect(() => latexToText('}{^_\\')).not.toThrow()
    expect(latexToText('')).toEqual([])
  })
})
