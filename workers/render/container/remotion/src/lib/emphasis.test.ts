import { describe, expect, it } from 'vitest'
import { accentIndex, isProductNumber, wordStrength } from './emphasis'
import { codeKind, isShortCode } from './looks'
import { styleOf } from './typeset'

describe('product and version numbers', () => {
  it('reads a number after a name or "version" as a name, not a measurement', () => {
    expect(isProductNumber('2.15', 'PyTorch')).toBe(true)
    expect(isProductNumber('2', 'Krea')).toBe(true)
    expect(isProductNumber('5090', 'RTX')).toBe(true)
    expect(isProductNumber('v3')).toBe(true)
    expect(isProductNumber('1.2.3')).toBe(true)
    expect(isProductNumber('3', 'version')).toBe(true)
  })

  it('keeps real quantities', () => {
    expect(isProductNumber('94.7%', 'achieved')).toBe(false)
    expect(isProductNumber('20', 'about')).toBe(false)
    expect(isProductNumber('12x', 'runs')).toBe(false)
    expect(isProductNumber('49.', 'Fizgig.')).toBe(false)
  })
})

describe('caption word strength', () => {
  it('ranks numbers and names over content words, never verbs, quantifiers or versions', () => {
    expect(wordStrength('94.7%', 'achieved')).toBe(3)
    expect(wordStrength('MOPD', 'the')).toBe(3)
    expect(wordStrength('outlook.com,', 'to')).toBe(3)
    expect(wordStrength('record', 'DNS')).toBe(2)
    for (const w of ['take', 'takes', 'runs', 'try', 'uses', "doesn't", 'quietly'])
      expect(wordStrength(w, 'it'), w).toBe(0)
    expect(wordStrength('one', 'is')).toBe(1)
    expect(wordStrength('2.15.', 'PyTorch')).toBe(0)
    expect(wordStrength('2', 'Krea')).toBe(0)
  })
})

describe('key point accent', () => {
  it('never puts a version number in the accent colour', () => {
    const words = 'Latest release moves to PyTorch 2.15'.split(' ')
    expect(words[accentIndex(words)]).toBe('PyTorch')
    expect(accentIndex('Runs on consumer GPUs'.split(' '))).toBe(3)
  })
})

describe('layout choices', () => {
  it('never sets a long word in the centred layout', () => {
    for (const t of ['P^2-MOPD: Joint Optimization', 'Authenticates Your Domain'])
      expect(styleOf(t)).not.toBe(1)
  })

  it('sets a short snippet as a labelled card', () => {
    expect(isShortCode(['v=DMARC1; p=none;'])).toBe(true)
    expect(isShortCode(['a', 'b', 'c'])).toBe(false)
    expect(codeKind('dns')).toBe('DNS record')
    expect(codeKind('bash')).toBe('Shell command')
    expect(codeKind('python')).toBe('Python snippet')
  })
})
