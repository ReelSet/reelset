import { beforeAll, describe, expect, it } from 'vitest'
import { fitBlock, measure, registerFonts, wrap } from './draw'

beforeAll(() => registerFonts())

describe('wrap', () => {
  it('keeps a word whole when only a smaller size would fit it', () => {
    const lines = wrap('RANSOMWARE gang', 'display', 150, 600, 0, 'none')
    expect(lines[0]).toBe('RANSOMWARE')
  })

  it('cuts hyphenated words at the hyphen, not mid-word', () => {
    const lines = wrap(
      'E-borrowing',
      'display',
      110,
      measure('borrowing', 'display', 110) + 8,
      0,
      'hyphen',
    )
    expect(lines).toEqual(['E-', 'borrowing'])
  })

  it('splits by characters only at the chars level', () => {
    const w = measure('abcdefghijklmnop', 'display', 100)
    const lines = wrap('abcdefghijklmnop', 'display', 100, w / 3, 0, 'chars')
    expect(lines.length).toBeGreaterThan(1)
    expect(lines.join('')).toBe('abcdefghijklmnop')
  })
})

describe('fitBlock', () => {
  it('shrinks the size before it breaks a long word', () => {
    const { size, lines } = fitBlock('RANSOMWARE', 'display', 833, 400, {
      max: 220,
      min: 50,
      ls: -0.035,
      maxLines: 3,
    })
    expect(lines).toEqual(['RANSOMWARE'])
    expect(size).toBeLessThan(220)
    expect(measure('RANSOMWARE', 'display', size, -0.035)).toBeLessThanOrEqual(833)
  })

  it('prefers a hyphen cut over splitting characters', () => {
    const w = measure('borrowing', 'display', 110) + 8
    const { lines } = fitBlock('E-borrowing', 'display', w, 600, {
      max: 110,
      min: 110,
      maxLines: 3,
    })
    expect(lines).toEqual(['E-', 'borrowing'])
  })

  it('falls back to character breaks at the minimum size', () => {
    const { size, lines } = fitBlock('Supercalifragilisticexpialidocious', 'display', 200, 800, {
      max: 60,
      min: 50,
      maxLines: 6,
    })
    expect(size).toBe(50)
    expect(lines.length).toBeGreaterThan(1)
  })
})
