import { describe, expect, it } from 'vitest'
import { contentHash, renderKey, sha256Hex, type RenderKeyInput } from './hash'

const base: RenderKeyInput = {
  itemId: '7f0c8b7e-6a3c-4e4a-9a51-2f1f5d0c9b11',
  contentHash: 'abc123',
  promptVersion: 'p1',
  templateVersion: 't1',
  voice: 'en-US-AriaNeural',
}

describe('sha256Hex', () => {
  it('matches the known SHA-256 of "abc"', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })
})

describe('renderKey', () => {
  it('is stable for the same inputs, so duplicate queue messages map to one render', async () => {
    expect(await renderKey(base)).toBe(await renderKey({ ...base }))
    expect(await renderKey(base)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('changes when any versioned input changes, so re-renders are possible', async () => {
    const original = await renderKey(base)
    for (const field of Object.keys(base) as (keyof RenderKeyInput)[]) {
      expect(await renderKey({ ...base, [field]: `${base[field]}-v2` })).not.toBe(original)
    }
  })

  it('does not collide when text shifts between fields', async () => {
    const a = await renderKey({ ...base, promptVersion: 'p1t', templateVersion: '1' })
    const b = await renderKey({ ...base, promptVersion: 'p1', templateVersion: 't1' })
    expect(a).not.toBe(b)
  })

  it('refuses empty fields instead of silently hashing them', async () => {
    await expect(renderKey({ ...base, voice: '  ' })).rejects.toThrow(/voice is empty/)
  })
})

describe('contentHash', () => {
  it('separates parts so ["ab","c"] and ["a","bc"] differ', async () => {
    expect(await contentHash(['ab', 'c'])).not.toBe(await contentHash(['a', 'bc']))
  })
})
