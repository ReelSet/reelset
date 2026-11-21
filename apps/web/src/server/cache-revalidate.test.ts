import pino from 'pino'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const revalidateTag = vi.fn()
vi.mock('next/cache', () => ({ revalidateTag: (...a: unknown[]) => revalidateTag(...a) }))

const { expireReels } = await import('./cache-revalidate')
const log = pino({ level: 'silent' })
const A = '0e6a5c1e-1111-4222-8333-444455556666'
const B = '7f00aa00-1111-4222-8333-444455556666'

describe('expireReels', () => {
  beforeEach(() => {
    revalidateTag.mockReset()
  })

  it('expires each reel tag once and the shared feed tag, immediately', () => {
    expireReels([A, B, A], log)
    const tags = revalidateTag.mock.calls.map((c) => c[0])
    expect(tags).toHaveLength(3)
    expect(tags.at(-1)).toBe('feed')
    expect(new Set(tags.slice(0, 2)).size).toBe(2)
    for (const call of revalidateTag.mock.calls) expect(call[1]).toEqual({ expire: 0 })
  })

  it('does nothing for an empty list', () => {
    expireReels([], log)
    expect(revalidateTag).not.toHaveBeenCalled()
  })

  it('logs instead of throwing when the cache store is missing', () => {
    revalidateTag.mockImplementation(() => {
      throw new Error('no store')
    })
    expect(() => expireReels([A], log)).not.toThrow()
  })
})
