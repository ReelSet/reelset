import { describe, expect, it } from 'vitest'
import { cueTime, parseCue } from './cues'
import { wordsFrom } from './fixtures'

const words = wordsFrom('Never run this scan before bed. Never ever skip it, because scanning matters.')

describe('parseCue', () => {
  it('reads word and occurrence', () => {
    expect(parseCue('regret#2')).toEqual({ word: 'regret', nth: 2 })
    expect(parseCue('Never')).toEqual({ word: 'Never', nth: 1 })
    expect(parseCue('C#')).toEqual({ word: 'C#', nth: 1 })
  })
})

describe('cueTime', () => {
  it('finds the first and nth match, ignoring case and punctuation', () => {
    expect(cueTime('never', words)).toBe(words[0]!.start)
    expect(cueTime('never#2', words)).toBe(words[6]!.start)
    expect(cueTime('bed', words)).toBe(words[5]!.start)
  })

  it('searches only inside the window', () => {
    const w = { from: words[6]!.start, to: 99 }
    expect(cueTime('never', words, w)).toBe(words[6]!.start)
    expect(cueTime('bed', words, w)).toBeNull()
  })

  it('falls back to a prefix match and matches short phrases', () => {
    expect(cueTime('scanned', words)).toBe(words[3]!.start)
    expect(cueTime('skip it', words)).toBe(words[8]!.start)
  })

  it('returns null instead of throwing when the word is missing', () => {
    expect(cueTime('banana', words)).toBeNull()
    expect(cueTime('never#3', words)).toBeNull()
    expect(cueTime('', words)).toBeNull()
  })
})
