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

  it('lets a stale queued post be failed without ever posting it', () => {
    expect(canTransitionPost(S.queued, S.failed)).toBe(true)
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
  const manual = { auto: false }
  const auto = { auto: true }
  const nyHour = (d: Date) =>
    Number(
      new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        hour: 'numeric',
        hourCycle: 'h23',
      }).format(d),
    )

  it('posts a manual post right away when no real post happened in the last 10 minutes', () => {
    const now = new Date('2026-11-11T04:02:00Z')
    expect(queuedPostEtas([manual], new Date('2026-11-11T03:40:00Z'), now)).toEqual([now])
    expect(queuedPostEtas([manual], null, now)).toEqual([now])
  })

  it('waits out the gap and lands on the next cron tick, then spaces later manual posts', () => {
    const now = new Date('2026-11-11T04:02:00Z')
    expect(queuedPostEtas([manual, manual], new Date('2026-11-11T03:58:00Z'), now)).toEqual([
      new Date('2026-11-11T04:10:00Z'),
      new Date('2026-11-11T04:20:00Z'),
    ])
  })

  it('never holds a manual post for posting hours', () => {
    const now = new Date('2026-11-11T08:00:00Z')
    expect(queuedPostEtas([manual], new Date('2026-11-11T07:55:00Z'), now)).toEqual([
      new Date('2026-11-11T08:05:00Z'),
    ])
  })

  it('holds an auto post at 15:20 ET until the evening window opens at 18:00 ET', () => {
    const now = new Date('2026-11-25T20:20:00Z')
    const [eta] = queuedPostEtas([auto], null, now)
    expect(eta).toEqual(new Date('2026-11-25T23:00:00Z'))
  })

  it('posts an auto post right away inside the window', () => {
    const now = new Date('2026-11-25T17:02:00Z')
    expect(queuedPostEtas([auto], new Date('2026-11-25T16:00:00Z'), now)).toEqual([now])
  })

  it('spaces auto posts at least 25 minutes apart and keeps them inside the window', () => {
    const now = new Date('2026-11-25T23:02:00Z')
    const etas = queuedPostEtas([auto, auto, auto], null, now)
    for (let i = 1; i < etas.length; i++)
      expect(etas[i]!.getTime() - etas[i - 1]!.getTime()).toBeGreaterThanOrEqual(25 * 60_000)
    for (const eta of etas) expect([18, 19, 20, 21, 22]).toContain(nyHour(eta))
  })

  it('rolls auto posts past the last window hour into the next morning', () => {
    const now = new Date('2026-11-26T04:30:00Z')
    const [eta] = queuedPostEtas([auto], null, now)
    expect(eta).toEqual(new Date('2026-11-26T16:00:00Z'))
  })

  it('walks the queue in order: a manual post uses its short gap before the auto one', () => {
    const now = new Date('2026-11-25T17:02:00Z')
    const last = new Date('2026-11-25T17:00:00Z')
    expect(queuedPostEtas([manual, auto], last, now)).toEqual([
      new Date('2026-11-25T17:10:00Z'),
      new Date('2026-11-25T17:35:00Z'),
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
