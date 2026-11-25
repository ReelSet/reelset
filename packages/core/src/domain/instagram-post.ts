import { z } from 'zod'
import { InstagramPostStatus } from '../db/enums'

export const INSTAGRAM_CAPTION_MAX_CHARS = 2200
export const INSTAGRAM_HASHTAG_MAX = 30
export const INSTAGRAM_MIN_GAP_MINUTES = 10
// Auto posts target US viewers: they go out only in these Eastern-time hours (11am to 3pm and 6pm
// to 11pm ET, so 8am to noon and 3pm to 8pm Pacific) and at least AUTO_GAP apart, which fits about
// 21 a day, above the daily reel cap. Studies agree midnight to 8am ET is the dead zone and midday
// and evening are the peaks. Posts an admin queues by hand are not held.
export const INSTAGRAM_POST_TIMEZONE = 'America/New_York'
export const INSTAGRAM_AUTO_POST_HOURS: readonly number[] = [11, 12, 13, 14, 18, 19, 20, 21, 22]
export const INSTAGRAM_AUTO_GAP_MINUTES = 25

// The worker's post call times out at 5 minutes inside a queue consumer, so 10 is well past any
// live upload.
export const INSTAGRAM_POSTING_STUCK_MINUTES = 10
// A lost post (worker died mid-upload) is looked up on Instagram for this long before giving up.
export const INSTAGRAM_LOST_RECHECK_DAYS = 3
export const INSTAGRAM_LOST_ERROR = 'No result recorded; checking Instagram for the reel'
// Written by failStuckPosts before the Instagram lookup existed.
export const LEGACY_INSTAGRAM_LOST_ERROR =
  'No result recorded; check Instagram before queueing it again'
export const INSTAGRAM_NOT_FOUND_ERROR =
  'Upload result was lost and the reel is not on Instagram; safe to queue it again'

const S = InstagramPostStatus

// `deleted` doubles as "cancelled" for a post that never went out.
const TRANSITIONS: Record<InstagramPostStatus, readonly InstagramPostStatus[]> = {
  draft: [S.queued, S.deleted],
  queued: [S.posting, S.failed, S.deleted],
  posting: [S.posted, S.failed, S.queued],
  posted: [S.deleting],
  deleting: [S.deleted, S.posted],
  // A failed post is retried by an admin, or found live by the lost-upload lookup.
  failed: [S.queued, S.deleted, S.posted],
  deleted: [],
}

/** True while a failed post may still turn up live on Instagram, so queueing it again could double-post. */
export function isLostLookupPending(
  error: string | null,
  startedAt: Date | null,
  now: Date,
): boolean {
  if (error !== INSTAGRAM_LOST_ERROR && error !== LEGACY_INSTAGRAM_LOST_ERROR) return false
  if (!startedAt) return false
  return startedAt.getTime() > now.getTime() - INSTAGRAM_LOST_RECHECK_DAYS * 86_400_000
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
  'disconnected',
])
export type IgAccountState = z.infer<typeof igAccountStateSchema>

export const igProxySchema = z.object({
  index: z.number().int().nonnegative(),
  country: z.string().nullable(),
  switched: z.boolean(),
  down: z.boolean(),
})
export type IgProxy = z.infer<typeof igProxySchema>

export const INSTAGRAM_PUBLISHERS = ['unofficial', 'official'] as const
export const instagramPublisherSchema = z.enum(INSTAGRAM_PUBLISHERS)
export type InstagramPublisher = z.infer<typeof instagramPublisherSchema>

export const igAccountSchema = z.object({
  username: z.string(),
  state: igAccountStateSchema,
  message: z.string().nullable(),
  checkedAt: z.string(),
  loginFailures: z.number().int().nonnegative(),
  proxy: igProxySchema.nullable().optional(),
  // Set only on the official (Meta API) account record.
  publisher: instagramPublisherSchema.optional(),
  tokenExpiresAt: z.string().nullable().optional(),
  /** False once a stats sync found the token cannot read insights (views, reach, saves, shares). */
  insightsPermission: z.boolean().optional(),
})

const PERMALINK_SHORTCODE = /instagram\.com\/(?:[^/]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/

/** The shortcode in a post or reel link; it is the same whichever API made the post. */
export function permalinkShortcode(permalink: string | null | undefined): string | null {
  return PERMALINK_SHORTCODE.exec(permalink ?? '')?.[1] ?? null
}
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
// Auto posts still queued after this long are stale news and are failed instead of posted.
export const INSTAGRAM_AUTO_MAX_QUEUED_HOURS = 36
export const INSTAGRAM_AUTO_EXPIRED_ERROR =
  'Skipped: waited over 36 hours to post, the story is stale.'

function nextCronTick(at: Date, cronMinutes: number): Date {
  const step = cronMinutes * 60_000
  return new Date(Math.ceil(at.getTime() / step) * step)
}

const nyHourFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: INSTAGRAM_POST_TIMEZONE,
  hour: 'numeric',
  hourCycle: 'h23',
})

function inAutoWindow(at: Date): boolean {
  return INSTAGRAM_AUTO_POST_HOURS.includes(Number(nyHourFormat.format(at)))
}

const MAX_WINDOW_SEARCH_DAYS = 7

/**
 * Estimated publish times for queued posts, given in claim order (admin posts first, then auto by
 * the judge's score). Each one is the first cron tick that is past the gap after the post before it
 * and, for an auto post, inside the US posting hours, which is what `claimNextPost` enforces.
 */
export function queuedPostEtas(
  queued: readonly { auto: boolean }[],
  lastPostedAt: Date | null,
  now: Date,
  cronMinutes = INSTAGRAM_CRON_MINUTES,
): Date[] {
  const step = cronMinutes * 60_000
  const searchLimit = (MAX_WINDOW_SEARCH_DAYS * 86_400_000) / step
  const etas: Date[] = []
  let previous = lastPostedAt
  queued.forEach((post, i) => {
    const gap = post.auto ? INSTAGRAM_AUTO_GAP_MINUTES : INSTAGRAM_MIN_GAP_MINUTES
    const wait = gapRemainingMs(previous, now, gap)
    let eta =
      wait === 0 && i === 0 ? now : nextCronTick(new Date(now.getTime() + wait), cronMinutes)
    if (post.auto && !inAutoWindow(eta)) {
      eta = nextCronTick(eta, cronMinutes)
      for (let n = 0; n < searchLimit && !inAutoWindow(eta); n++)
        eta = new Date(eta.getTime() + step)
    }
    etas.push(eta)
    previous = eta
  })
  return etas
}
