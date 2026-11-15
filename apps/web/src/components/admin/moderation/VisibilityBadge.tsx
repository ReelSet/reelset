import {
  HIDDEN_REASON_LABELS,
  parseVisibilityValue,
  type HiddenReason,
} from '@/lib/admin/hidden-reasons'

const REASONS = HIDDEN_REASON_LABELS as Record<string, string>

/** Quiet marker for items that are not plain public; renders nothing for public. */
export function VisibilityBadge({
  visibility,
  reason,
}: {
  visibility: string
  reason?: HiddenReason | string | null
}) {
  const value = parseVisibilityValue(visibility)
  if (value === 'public') return null
  if (value === 'private') return <span className="text-xs text-faint">Private (requested)</span>
  const label = reason ? (REASONS[reason] ?? reason) : null
  return (
    <span className="text-xs text-warn">
      {label ? `Hidden · ${label}` : 'Hidden from the feed'}
    </span>
  )
}
