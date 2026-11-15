import type { PublishState } from '@reelset/core'
import { formatInZone } from '@/lib/time/zone'

export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

export function clock(iso: string | null, tz: string): string | null {
  return iso ? formatInZone(iso, tz, 'time') : null
}

export function resetsLabel(iso: string, tz: string): string {
  return formatInZone(iso, tz, 'datetime')
}

export function friendlyError(error: string | null): string {
  if (!error) return 'Something went wrong while making this reel. Your credits were refunded.'
  return error
}

export const FEED_STATE_LABEL: Record<PublishState, string> = {
  none: 'Private',
  in_review: 'In review',
  live: 'Live in the feed',
  rejected: 'Not accepted',
}
