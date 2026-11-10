import { z } from 'zod'
import { InstagramPostStatus } from '../db/enums'

export const INSTAGRAM_CAPTION_MAX_CHARS = 2200
export const INSTAGRAM_HASHTAG_MAX = 30
export const INSTAGRAM_MIN_GAP_MINUTES = 10
export const INSTAGRAM_POSTING_STUCK_MINUTES = 20

const S = InstagramPostStatus

// `deleted` doubles as "cancelled" for a post that never went out.
const TRANSITIONS: Record<InstagramPostStatus, readonly InstagramPostStatus[]> = {
  draft: [S.queued, S.deleted],
  queued: [S.posting, S.deleted],
  posting: [S.posted, S.failed, S.queued],
  posted: [S.deleting],
  deleting: [S.deleted, S.posted],
  failed: [S.deleted],
  deleted: [],
}

export class InvalidInstagramTransitionError extends Error {
  constructor(
    readonly from: InstagramPostStatus,
    readonly to: InstagramPostStatus,
  ) {
    super(`invalid instagram post transition: ${from} -> ${to}`)
    this.name = 'InvalidInstagramTransitionError'
  }
}

export function canTransitionPost(from: InstagramPostStatus, to: InstagramPostStatus): boolean {
  return TRANSITIONS[from].includes(to)
}

export function assertPostTransition(from: InstagramPostStatus, to: InstagramPostStatus): void {
  if (!canTransitionPost(from, to)) throw new InvalidInstagramTransitionError(from, to)
}

export const igAccountStateSchema = z.enum([
  'connected',
  'needs_login',
  'needs_code',
  'challenge',
  'unknown',
])
export type IgAccountState = z.infer<typeof igAccountStateSchema>

export const igProxySchema = z.object({
  index: z.number().int().nonnegative(),
  country: z.string().nullable(),
  switched: z.boolean(),
  down: z.boolean(),
})
export type IgProxy = z.infer<typeof igProxySchema>

export const igAccountSchema = z.object({
  username: z.string(),
  state: igAccountStateSchema,
  message: z.string().nullable(),
  checkedAt: z.string(),
  loginFailures: z.number().int().nonnegative(),
  proxy: igProxySchema.nullable().optional(),
})
export type IgAccount = z.infer<typeof igAccountSchema>

export const IG_LOGIN_FAILURE_ADVICE_AFTER = 3

export function gapRemainingMs(
  lastAttemptAt: Date | null,
  now: Date,
  minGapMinutes = INSTAGRAM_MIN_GAP_MINUTES,
): number {
  if (!lastAttemptAt) return 0
  return Math.max(0, lastAttemptAt.getTime() + minGapMinutes * 60_000 - now.getTime())
}

export const INSTAGRAM_CRON_MINUTES = 5

function nextCronTick(at: Date, cronMinutes: number): Date {
  const step = cronMinutes * 60_000
  return new Date(Math.ceil(at.getTime() / step) * step)
}

/** Estimated publish times for queued posts in order: gap after the last real post, picked up by the cron. */
export function queuedPostEtas(
  queuedCount: number,
  lastPostedAt: Date | null,
  now: Date,
  minGapMinutes = INSTAGRAM_MIN_GAP_MINUTES,
  cronMinutes = INSTAGRAM_CRON_MINUTES,
): Date[] {
  const etas: Date[] = []
  let previous = lastPostedAt
  for (let i = 0; i < queuedCount; i++) {
    const wait = gapRemainingMs(previous, now, minGapMinutes)
    const eta =
      wait === 0 && i === 0 ? now : nextCronTick(new Date(now.getTime() + wait), cronMinutes)
    etas.push(eta)
    previous = eta
  }
  return etas
}
