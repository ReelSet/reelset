import { describe, expect, it } from 'vitest'
import { narrationText, reelScriptSchema, type ReelScript } from './reel-script'

const chunkId = '0b6f3c1e-8a4d-4f2a-9c3b-5e7d1a2b3c4d'

const valid: ReelScript = {
  version: 1,
  hook: 'A Postgres feature you have wanted for ten years just shipped.',
  beats: [
    {
      text: 'REPACK CONCURRENTLY rebuilds bloated tables online.',
      visual: { type: 'title', title: 'REPACK CONCURRENTLY' },
    },
    {
      text: 'It only takes a brief lock at the very end.',
      visual: { type: 'code', language: 'sql', code: 'REPACK CONCURRENTLY orders;' },
    },
  ],
  outro: 'Link in the card.',
  claims: [{ text: 'Rebuilds online', chunkIds: [chunkId] }],
}

describe('reelScriptSchema', () => {
  it('accepts a well-formed script', () => {
    expect(reelScriptSchema.parse(valid)).toEqual(valid)
  })

  it('rejects claims with no supporting chunk (every claim must cite the source)', () => {
    const bad = { ...valid, claims: [{ text: 'Made up', chunkIds: [] }] }
    expect(reelScriptSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects too few or too many beats', () => {
    expect(reelScriptSchema.safeParse({ ...valid, beats: valid.beats.slice(0, 1) }).success).toBe(
      false,
    )
    const many = Array.from({ length: 7 }, () => valid.beats[0]!)
    expect(reelScriptSchema.safeParse({ ...valid, beats: many }).success).toBe(false)
  })

  it('rejects unknown visual types and wrong versions', () => {
    const badVisual = {
      ...valid,
      beats: [valid.beats[0], { text: 'x', visual: { type: 'stock_video', url: 'https://x' } }],
    }
    expect(reelScriptSchema.safeParse(badVisual).success).toBe(false)
    expect(reelScriptSchema.safeParse({ ...valid, version: 2 }).success).toBe(false)
  })

  it('builds narration from hook, beats and outro in order', () => {
    expect(narrationText(valid)).toBe(
      `${valid.hook} ${valid.beats[0]!.text} ${valid.beats[1]!.text} ${valid.outro}`,
    )
  })
})
