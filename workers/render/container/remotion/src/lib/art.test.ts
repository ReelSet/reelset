import { describe, expect, it } from 'vitest'
import { ART_KINDS, artForSlot, hashSeed, planArt, rankArt, rng, toolName } from './art'
import type { ReelProps } from './types'

const base = { title: 'A thing', texts: [] as string[], visualTypes: [] as string[] }

describe('rankArt', () => {
  it('ranks every kind exactly once', () => {
    const ranked = rankArt({ ...base, source: 'news' })
    expect([...ranked].sort()).toEqual([...ART_KINDS].sort())
  })

  it('defaults by source', () => {
    expect(rankArt({ ...base, source: 'github' })[0]).toBe('gitgraph')
    expect(rankArt({ ...base, source: 'youtube' })[0]).toBe('timeline')
    expect(rankArt({ ...base, source: 'reddit' })[0]).toBe('thread')
    expect(rankArt({ ...base, source: 'hn' })[0]).toBe('thread')
    expect(rankArt({ ...base, source: 'papers' })[0]).toBe('paper')
  })

  it('lets strong keywords override the source default', () => {
    const ranked = rankArt({
      source: 'hn',
      title: 'New LLM model beats GPT on every benchmark',
      texts: ['The neural model is 40% faster'],
      visualTypes: [],
    })
    expect(ranked[0]).toBe('network')
    expect(ranked.indexOf('bars')).toBeLessThan(3)
  })

  it('uses visual types as signals', () => {
    expect(rankArt({ ...base, source: 'hn', visualTypes: ['stat', 'stat'] })[0]).toBe('bars')
    expect(
      rankArt({ ...base, source: 'news', visualTypes: ['code', 'code'], texts: ['cli tool'] })[0],
    ).toBe('terminal')
  })

  it('is deterministic', () => {
    const input = { ...base, source: 'news' as const, texts: ['docker and kubernetes'] }
    expect(rankArt(input)).toEqual(rankArt(input))
  })
})

describe('planArt', () => {
  const props: Pick<ReelProps, 'source' | 'title' | 'scenes'> = {
    source: 'github',
    title: 'Faster Rust compiler',
    scenes: [
      { kind: 'hook', start: 0, end: 2, text: 'A faster compiler' },
      {
        kind: 'beat',
        start: 2,
        end: 4,
        text: 'Builds are 3x faster',
        visual: { type: 'stat', label: 'speedup', value: '3x' },
      },
      { kind: 'outro', start: 4, end: 5, text: 'bye' },
    ],
  }

  it('plans from source, title and script and rotates slots over the top three', () => {
    const plan = planArt(props)
    expect(plan.seed).toBe(hashSeed('Faster Rust compiler'))
    expect(artForSlot(plan, 0)).toBe(plan.ranked[0])
    expect(artForSlot(plan, 3)).toBe(plan.ranked[0])
    expect(new Set([0, 1, 2].map((s) => artForSlot(plan, s))).size).toBe(3)
  })
})

describe('toolName', () => {
  it('takes a short lowercase word from the title', () => {
    expect(toolName('NX2navi: Native Ocarina of Time')).toBe('nx2navi')
    expect(toolName('tangerineturtle1/NX2navi')).toBe('nx2navi')
    expect(toolName('The Quick Fix')).toBe('quick')
    expect(toolName('!!!')).toBe('app')
  })
})

describe('rng', () => {
  it('is seeded and stays in [0, 1)', () => {
    const a = rng(7)
    const b = rng(7)
    const seq = Array.from({ length: 50 }, () => a())
    expect(seq).toEqual(Array.from({ length: 50 }, () => b()))
    expect(seq.every((n) => n >= 0 && n < 1)).toBe(true)
    expect(rng(8)()).not.toBe(seq[0])
  })
})
