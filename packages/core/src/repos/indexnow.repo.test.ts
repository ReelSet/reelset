import { describe, expect, it, vi } from 'vitest'
import { createLogger } from '../lib/logger'
import { fakeDb } from './fake-db'
import { announceReel } from './indexnow.repo'

const log = createLogger({ app: 'test', level: 'silent' })
const id = '218507c9-44e9-4128-aa63-9ecfb83a7d81'

describe('announceReel', () => {
  it('submits the canonical url of a public rendered reel', async () => {
    const { db, log: stmts } = fakeDb(() => [{ id, title: 'Bun 2 ships' }])
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }))
    expect(await announceReel(db, id, log, fetchImpl)).toBe('sent')
    expect(stmts[0]).toContain('"visibility" = $')
    expect(stmts[0]).toContain('"status" = $')
    const body = JSON.parse(
      (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
    )
    expect(body.urlList).toEqual(['https://reelset.app/r/bun-2-ships-218507c9'])
  })

  it('stays quiet for private, hidden or unfinished reels', async () => {
    const { db } = fakeDb(() => [])
    const fetchImpl = vi.fn()
    expect(await announceReel(db, id, log, fetchImpl)).toBe('not_public')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('never throws when the lookup fails', async () => {
    const { db } = fakeDb(() => {
      throw new Error('db down')
    })
    expect(await announceReel(db, id, log, vi.fn())).toBe('failed')
  })
})
