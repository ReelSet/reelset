import { ItemStatus } from '../db/enums'

/** Admitted items that will never become a reel, so they give their daily-cap slot back. */
export const CAP_EXEMPT_STATUSES: ItemStatus[] = [
  ItemStatus.failed,
  ItemStatus.insufficient_source,
  ItemStatus.source_only,
]

export const PACE_LEAD_MINUTES = 60

const DAY_MINUTES = 24 * 60

/**
 * Share of today's reel and spend caps open at `now`. The caps open evenly across the UTC day,
 * one hour's share early, so stories found in the afternoon still get a slot.
 */
export function dayShare(now: Date): number {
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes() + now.getUTCSeconds() / 60
  return Math.min(1, (minutes + PACE_LEAD_MINUTES) / DAY_MINUTES)
}

/** Reel slots open so far today. */
export function pacedCap(dailyCap: number, now: Date): number {
  return Math.min(dailyCap, Math.ceil(dailyCap * dayShare(now)))
}
