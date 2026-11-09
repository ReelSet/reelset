import { describe, expect, it } from 'vitest'
import { formatStat, parseStat } from './count'

describe('parseStat', () => {
  it('splits prefix, number and suffix', () => {
    expect(parseStat('12.4k')).toEqual({
      prefix: '',
      value: 12.4,
      decimals: 1,
      suffix: 'k',
      grouped: false,
    })
    expect(parseStat('$12,400,000')).toMatchObject({
      prefix: '$',
      value: 12_400_000,
      grouped: true,
    })
    expect(parseStat('98%')).toMatchObject({ value: 98, suffix: '%' })
    expect(parseStat('60+')).toMatchObject({ value: 60, suffix: '+' })
  })

  it('returns null for values without digits', () => {
    expect(parseStat('Rust')).toBeNull()
  })
})

describe('formatStat', () => {
  it('counts up and lands exactly on the final value', () => {
    const stat = parseStat('12.4k')!
    expect(formatStat(stat, 0)).toBe('0.0k')
    expect(formatStat(stat, 0.5)).toBe('6.2k')
    expect(formatStat(stat, 1)).toBe('12.4k')
    expect(formatStat(stat, 7)).toBe('12.4k')
    expect(formatStat(parseStat('$12,400,000')!, 1)).toBe('$12,400,000')
  })
})
