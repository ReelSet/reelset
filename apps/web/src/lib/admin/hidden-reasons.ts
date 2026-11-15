export const HIDDEN_REASONS = ['spam', 'low_quality', 'other'] as const
export type HiddenReason = (typeof HIDDEN_REASONS)[number]

export const HIDDEN_REASON_LABELS: Record<HiddenReason, string> = {
  spam: 'Spam',
  low_quality: 'Low quality',
  other: 'Other',
}

const VISIBILITIES = ['public', 'private', 'hidden'] as const
export type Visibility = (typeof VISIBILITIES)[number]

// Unknown values read as hidden so a bad row never looks public.
export function parseVisibilityValue(value: string): Visibility {
  return (VISIBILITIES as readonly string[]).includes(value) ? (value as Visibility) : 'hidden'
}
