import { describe, expect, it } from 'vitest'
import {
  findNumbers,
  headlineFrom,
  keyPhraseIn,
  salientPhrase,
  shellLines,
  spokenCommand,
  versusPair,
} from './extract'

describe('findNumbers', () => {
  it('finds numbers with units and counts next to nouns', () => {
    expect(findNumbers('Anthropic shipped 23 releases this month')[0]?.raw).toBe('23')
    expect(findNumbers('Anthropic shipped 23 releases this month')[0]?.label).toBe(
      'releases this month',
    )
    expect(findNumbers('about 95% of memory is idle')[0]?.raw).toBe('95%')
    expect(findNumbers('gains of up to +6.1% on coding')[0]?.raw).toContain('6.1%')
    expect(findNumbers('uses ~250 GB of memory')[0]?.raw).toBe('~250 GB')
  })

  it('skips versions, ordinals, years and tiny numbers', () => {
    expect(findNumbers('Launched October 7th with Opus 5.5 in 2026')).toEqual([])
    expect(findNumbers('Qwen3.5 has 3 experts')).toEqual([])
  })
})

describe('headlineFrom', () => {
  it('takes the first sentence in at most 7 words with no dangling stopword', () => {
    expect(
      headlineFrom('Did you miss the latest Claude Code updates? Anthropic shipped 23 releases.'),
    ).toBe('Did you miss the latest Claude Code')
    expect(headlineFrom('Want faster 3D reconstruction? Feed-forward is efficient')).toBe(
      'Want faster 3D reconstruction?',
    )
  })
  it('never returns empty for a short hook', () => {
    expect(headlineFrom('Meet unslop')).toBe('Meet unslop')
  })
})

describe('text helpers', () => {
  it('detects shell commands', () => {
    expect(shellLines('git clone https://x/y\ncd y')).toEqual(['git clone https://x/y', 'cd y'])
    expect(shellLines('const a = 1')).toBeNull()
  })
  it('finds versus pairs', () => {
    expect(versusPair('Bun beats Node on startup')).toEqual(['Bun', 'Node'])
    expect(versusPair('nothing to compare')).toBeNull()
  })
  it('picks a salient phrase and key phrase', () => {
    expect(salientPhrase('It holds 256 experts per layer')).toContain('256')
    expect(salientPhrase('the quick Kubernetes upgrade')).toContain('Kubernetes')
    expect(keyPhraseIn('Gaussian Spacing Normalization fixes it')).toBeTruthy()
  })
})

describe('spokenCommand', () => {
  it('takes the command a sentence tells you to run, up to the first plain word', () => {
    expect(
      spokenCommand('Run dig +short TXT _dmarc.example.com today. No output means none.'),
    ).toBe('dig +short TXT _dmarc.example.com')
    expect(spokenCommand('Run npx fizgig to try it.')).toBe('npx fizgig')
    expect(spokenCommand('Run pip install torch then restart.')).toBe('pip install torch')
    expect(spokenCommand('Try npm i -g foo.')).toBe('npm i -g foo')
    expect(spokenCommand('Run git clone https://github.com/a/b and cd in.')).toBe(
      'git clone https://github.com/a/b',
    )
  })

  it('needs an argument and a verb that tells you to run it', () => {
    expect(spokenCommand('Run dig and see.')).toBeNull()
    expect(spokenCommand('We run git constantly.')).toBeNull()
    expect(spokenCommand('The fix is one DNS record.')).toBeNull()
  })
})
