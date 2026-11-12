import { describe, expect, it } from 'vitest'
import { estimateLines, fitText } from './text'

describe('fitText', () => {
  const box = { width: 564, height: 300 }

  it('uses the max size for short text and shrinks for long text', () => {
    const short = fitText('Short hook', box, { min: 38, max: 76 })
    const long = fitText('word '.repeat(24).trim(), box, { min: 38, max: 76 })
    expect(short).toBe(76)
    expect(long).toBeLessThan(short)
    expect(long).toBeGreaterThanOrEqual(38)
  })

  it('never goes below min even if the text cannot fit', () => {
    expect(fitText('x '.repeat(400), box, { min: 30, max: 60 })).toBe(30)
  })

  it('counts wrapped lines including words longer than a line', () => {
    expect(estimateLines('aaaa bbbb cccc', 9 * 10, 10)).toBe(2)
    expect(estimateLines('a'.repeat(25), 100, 10)).toBe(3)
  })
})
