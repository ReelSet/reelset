import { describe, expect, it } from 'vitest'
import { likeBodySchema, likeOutcome } from './likes'

describe('likeOutcome', () => {
  it('reports a change only when a row was written or removed', () => {
    expect(likeOutcome(true, 1n)).toEqual({ liked: true, changed: true })
    expect(likeOutcome(true, 0n)).toEqual({ liked: true, changed: false })
    expect(likeOutcome(false, 1)).toEqual({ liked: false, changed: true })
    expect(likeOutcome(false, 0)).toEqual({ liked: false, changed: false })
  })
})

describe('likeBodySchema', () => {
  it('requires a uuid and a boolean', () => {
    const itemId = '0b5d2f3e-6a1c-4e0b-9a55-1c2d3e4f5a6b'
    expect(likeBodySchema.safeParse({ itemId, liked: true }).success).toBe(true)
    expect(likeBodySchema.safeParse({ itemId, liked: 'yes' }).success).toBe(false)
    expect(likeBodySchema.safeParse({ itemId: 'x', liked: true }).success).toBe(false)
  })
})
