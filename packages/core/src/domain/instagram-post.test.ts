import { describe, expect, it } from 'vitest'
import { InstagramPostStatus as S } from '../db/enums'
import {
  InvalidInstagramTransitionError,
  assertPostTransition,
  queuedPostEtas,
  canTransitionPost,
  gapRemainingMs,
} from './instagram-post'

describe('instagram post state machine', () => {
  it('allows the happy path', () => {
    expect(canTransitionPost(S.queued, S.posting)).toBe(true)
    expect(canTransitionPost(S.posting, S.posted)).toBe(true)
    expect(canTransitionPost(S.posted, S.deleting)).toBe(true)
    expect(canTransitionPost(S.deleting, S.deleted)).toBe(true)
  })

  it('never re-queues a failed post and never skips posting', () => {
    expect(canTransitionPost(S.failed, S.queued)).toBe(false)
    expect(canTransitionPost(S.queued, S.posted)).toBe(false)
    expect(canTransitionPost(S.posted, S.queued)).toBe(false)
    expect(canTransitionPost(S.deleted, S.queued)).toBe(false)
  })

  it('lets a posting row return to the queue (session needs login)', () => {
    expect(canTransitionPost(S.posting, S.queued)).toBe(true)
  })

  it('throws a typed error on an invalid move', () => {
    expect(() => assertPostTransition(S.posted, S.queued)).toThrow(InvalidInstagramTransitionError)
  })
})

describe('gapRemainingMs', () => {
  const now = new Date('2026-11-11T12:00:00Z')
  it('is zero with no previous attempt or after the gap', () => {
    expect(gapRemainingMs(null, now)).toBe(0)
    expect(gapRemainingMs(new Date('2026-11-11T11:40:00Z'), now)).toBe(0)
  })
  it('returns the time left inside the gap', () => {
    expect(gapRemainingMs(new Date('2026-11-11T11:55:00Z'), now, 10)).toBe(5 * 60_000)
  })
})

describe('queuedPostEtas', () => {
  const now = new Date('2026-11-11T04:02:00Z')

  it('posts right away when no real post happened in the last 10 minutes', () => {
    expect(queuedPostEtas(1, new Date('2026-11-11T03:40:00Z'), now)).toEqual([now])
    expect(queuedPostEtas(1, null, now)).toEqual([now])
  })

  it('waits out the gap and lands on the next cron tick, then spaces later posts', () => {
    expect(queuedPostEtas(2, new Date('2026-11-11T03:58:00Z'), now)).toEqual([
      new Date('2026-11-11T04:10:00Z'),
      new Date('2026-11-11T04:20:00Z'),
    ])
  })
})
