import { discardItemAction, retryItemAction } from '@/app/admin/actions'
import { suggestRetryStage } from '@/lib/admin/retry'
import { button } from '@/components/admin/ui'
import { SubmitButton } from '@/components/admin/SubmitButton'

// Same server action as the old Retry form: failed -> suggested earlier stage, never a blind restart.
export function QuickRetry({
  itemId,
  lastOkStage,
  returnTo,
  withDiscard = true,
}: {
  itemId: string
  lastOkStage: string | null
  returnTo: string
  withDiscard?: boolean
}) {
  const stage = suggestRetryStage(lastOkStage)
  return (
    <div className="flex items-center gap-1.5">
      <form action={retryItemAction}>
        <input type="hidden" name="itemId" value={itemId} />
        <input type="hidden" name="stage" value={stage} />
        <input type="hidden" name="returnTo" value={returnTo} />
        <SubmitButton className={button} pendingLabel="Retrying">
          Retry from {stage}
        </SubmitButton>
      </form>
      {withDiscard ? (
        <form action={discardItemAction}>
          <input type="hidden" name="id" value={itemId} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <SubmitButton className={`${button} text-muted`} pendingLabel="Discarding">
            Discard
          </SubmitButton>
        </form>
      ) : null}
    </div>
  )
}
