import { z } from 'zod'

export const ITEM_VISIBILITIES = ['public', 'private', 'hidden'] as const
export type ItemVisibility = (typeof ITEM_VISIBILITIES)[number]

export const HIDDEN_REASONS = ['spam', 'low_quality', 'other'] as const
export type HiddenReason = (typeof HIDDEN_REASONS)[number]

export const HIDDEN_REASON_LABELS: Record<HiddenReason, string> = {
  spam: 'Spam',
  low_quality: 'Low quality',
  other: 'Other',
}

export const hiddenReasonSchema = z.enum(HIDDEN_REASONS)

export const HIDDEN_INSTAGRAM_ERROR = 'Hidden from the feed'

export const HIDDEN_REQUEST_MESSAGE =
  'That item is not available as a reel. Your credits were refunded.'

// Any stored value outside the enum is treated as hidden so a bad row never leaks publicly.
export function parseVisibility(value: string): ItemVisibility {
  return (ITEM_VISIBILITIES as readonly string[]).includes(value)
    ? (value as ItemVisibility)
    : 'hidden'
}
