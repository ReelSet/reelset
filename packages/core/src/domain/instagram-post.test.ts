import { describe, expect, it } from 'vitest'
import { InstagramPostStatus as S } from '../db/enums'
import {
  InvalidInstagramTransitionError,
  assertPostTransition,
  queuedPostEtas,
  canTransitionPost,
  gapRemainingMs,
  isLostLookupPending,
  INSTAGRAM_LOST_ERROR,
  INSTAGRAM_NOT_FOUND_ERROR,
  INSTAGRAM_LOST_RECHECK_DAYS,
} from './instagram-post'

describe('instagram post state machine', () => {
  it('allows the happy path', () => {
    expect(canTransitionPost(S.queued, S.posting)).toBe(true)
    expect(canTransitionPost(S.posting, S.posted)).toBe(true)
    expect(canTransitionPost(S.posted, S.deleting)).toBe(true)
    expect(canTransitionPost(S.deleting, S.deleted)).toBe(true)
  })

  it('lets an admin re-queue a failed post but never skips posting', () => {
    expect(canTransitionPost(S.failed, S.queued)).toBe(true)
    expect(canTransitionPost(S.queued, S.posted)).toBe(false)
    expect(canTransitionPost(S.posted, S.queued)).toBe(false)
    expect(canTransitionPost(S.deleted, S.queued)).toBe(false)
  })

  it('marks a lost upload posted once it is found live on Instagram', () => {
    expect(canTransitionPost(S.failed, S.posted)).toBe(true)
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

describe('isLostLookupPending', () => {
  const now = new Date('2026-11-15T12:00:00Z')
  const ago = (days: number) => new Date(now.getTime() - days * 86_400_000)

  it('is pending inside the recheck window', () => {
    expect(isLostLookupPending(INSTAGRAM_LOST_ERROR, ago(1), now)).toBe(true)
  })

  it('is retryable once the window has passed', () => {
    expect(
      isLostLookupPending(INSTAGRAM_LOST_ERROR, ago(INSTAGRAM_LOST_RECHECK_DAYS + 0.1), now),
    ).toBe(false)
  })

  it('is retryable when the lookup found nothing, held rows and unknown errors', () => {
    expect(isLostLookupPending(INSTAGRAM_NOT_FOUND_ERROR, ago(0), now)).toBe(false)
    expect(isLostLookupPending('Held: auto-post was turned off', ago(0), now)).toBe(false)
    expect(isLostLookupPending(null, null, now)).toBe(false)
  })

  it('never looks up a lost row without a start time', () => {
    expect(isLostLookupPending(INSTAGRAM_LOST_ERROR, null, now)).toBe(false)
  })
})
