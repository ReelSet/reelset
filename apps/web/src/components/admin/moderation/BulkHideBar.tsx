import { hideItemsAction, unhideItemsAction } from '@/app/admin/actions'
import { SubmitButton } from '@/components/admin/SubmitButton'
import { button, buttonPrimary } from '@/components/admin/ui'
import { ReasonSelect } from './HideControls'

export const BULK_FORM_ID = 'bulk-visibility'

/** One form for the whole Items table: rows join it through the checkbox `form` attribute. */
export function BulkHideBar({ returnTo, count }: { returnTo: string; count: number }) {
  return (
    <form
      id={BULK_FORM_ID}
      action={hideItemsAction}
      className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface px-3 py-2"
    >
      <input type="hidden" name="returnTo" value={returnTo} />
      <span className="text-xs text-muted">{count} on this page</span>
      <ReasonSelect />
      <SubmitButton
        className={buttonPrimary}
        pendingLabel="Hiding"
        confirm="Hide the selected items from the feed?"
      >
        Hide selected
      </SubmitButton>
      <SubmitButton className={button} formAction={unhideItemsAction} pendingLabel="Unhiding">
        Unhide selected
      </SubmitButton>
    </form>
  )
}
