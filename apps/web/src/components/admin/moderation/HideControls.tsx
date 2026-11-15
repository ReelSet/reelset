import { HIDDEN_REASONS, HIDDEN_REASON_LABELS } from '@/lib/admin/hidden-reasons'
import { hideItemsAction, unhideItemsAction } from '@/app/admin/actions'
import { SubmitButton } from '@/components/admin/SubmitButton'
import { button, input } from '@/components/admin/primitives'

export function ReasonSelect({ form, className = '' }: { form?: string; className?: string }) {
  return (
    <select
      name="reason"
      form={form}
      aria-label="Reason"
      defaultValue="spam"
      className={`${input} py-1 text-xs ${className}`}
    >
      {HIDDEN_REASONS.map((reason) => (
        <option key={reason} value={reason}>
          {HIDDEN_REASON_LABELS[reason]}
        </option>
      ))}
    </select>
  )
}

/** Hide (with reason) or unhide one item; private requested reels have no moderation controls. */
export function HideControls({
  itemId,
  visibility,
  returnTo,
}: {
  itemId: string
  visibility: string
  returnTo: string
}) {
  if (visibility === 'private') return null
  const hidden = visibility === 'hidden'
  return (
    <form
      action={hidden ? unhideItemsAction : hideItemsAction}
      className="flex items-center gap-1.5"
    >
      <input type="hidden" name="itemId" value={itemId} />
      <input type="hidden" name="returnTo" value={returnTo} />
      {hidden ? null : <ReasonSelect />}
      <SubmitButton className={button} pendingLabel={hidden ? 'Unhiding' : 'Hiding'}>
        {hidden ? 'Unhide' : 'Hide from feed'}
      </SubmitButton>
    </form>
  )
}
