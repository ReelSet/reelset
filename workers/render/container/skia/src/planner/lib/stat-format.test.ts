import { describe, expect, it } from 'vitest'
import { valueOf } from './labels'
import { typeset } from './typeset'
import { displayStat, tidyDecimals } from './stat-format'

describe('tidyDecimals', () => {
  it('rounds the 16-digit probability that showed on screen to 3 decimals', () => {
    expect(tidyDecimals('0.9982666969299316')).toBe('0.998')
  })

  it('keeps 3 significant digits for tiny values instead of rounding them to zero', () => {
    expect(tidyDecimals('0.0010246571619063616')).toBe('0.00102')
  })

  it('leaves short numbers, units and grouping alone', () => {
    expect(tidyDecimals('94.7%')).toBe('94.7%')
    expect(tidyDecimals('12,400')).toBe('12,400')
    expect(tidyDecimals('2.5×')).toBe('2.5×')
    expect(tidyDecimals('$1,234.56')).toBe('$1,234.56')
  })

  it('rounds inside grouped numbers and trims trailing zeros', () => {
    expect(tidyDecimals('12,345.67891')).toBe('12,345.679')
    expect(tidyDecimals('4.50001')).toBe('4.5')
  })

  it('shows a value that grounds to the same number as the original', () => {
    for (const raw of ['0.9982666969299316', '0.0010246571619063616', '12.34567', '0.0456789']) {
      expect(valueOf(tidyDecimals(raw))).toBe(valueOf(raw))
    }
  })
})

describe('displayStat', () => {
  it('reads a bare probability as a percent when the label says so', () => {
    expect(displayStat('0.9982666969299316', 'probability for billing')).toBe('99.8%')
    expect(displayStat('0.5', 'probability')).toBe('0.5')
  })

  it('rounds, not converts, when the label is not about probability', () => {
    expect(displayStat('0.9982666969299316', 'billing')).toBe('0.998')
  })
})

describe('typeset', () => {
  it('rounds a long decimal inside display text', () => {
    expect(typeset('Billing wins with 0.9982666969299316')).toBe('Billing wins with 0.998')
  })
})
