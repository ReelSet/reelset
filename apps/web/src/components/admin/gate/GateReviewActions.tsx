import {
  clearGateLabelAction,
  disagreeAndMakeReelAction,
  labelGateDecisionAction,
  makeReelAnywayAction,
} from '@/app/admin/(pipeline)/gate/actions'
import { SubmitButton } from '@/components/admin/SubmitButton'
import { button, buttonPrimary, input } from '@/components/admin/primitives'
import type { GateView } from '@/lib/admin/gate-view'

const NOTE_MAX_CHARS = 500

type Props = {
  gate: GateView
  itemStatus: string
  returnTo: string
  keyHints?: boolean
}

function Key({ children }: { children: string }) {
  return (
    <kbd className="ml-1 rounded border border-line px-1 font-mono text-[10px] text-faint">
      {children}
    </kbd>
  )
}

function Hidden({ gate, returnTo }: Pick<Props, 'gate' | 'returnTo'>) {
  return (
    <>
      <input type="hidden" name="id" value={gate.decisionId} />
      <input type="hidden" name="returnTo" value={returnTo} />
    </>
  )
}

function DisagreeForm({ gate, itemStatus, returnTo, keyHints }: Props) {
  const canOverride = gate.verdict === 'source_only' && itemStatus === 'source_only'
  return (
    <details data-gate-disagree className="group">
      <summary
        className={`${button} cursor-pointer list-none [&::-webkit-details-marker]:hidden ${
          gate.label === 'disagree' ? 'border-warn/50 text-warn' : ''
        }`}
      >
        Disagree{keyHints ? <Key>D</Key> : null}
      </summary>
      <form action={labelGateDecisionAction} data-gate-form className="mt-2 grid w-56 gap-1.5">
        <Hidden gate={gate} returnTo={returnTo} />
        <input type="hidden" name="label" value="disagree" />
        <select name="reason" required defaultValue="" aria-label="Reason" className={input}>
          <option value="" disabled>
            {gate.disagreePrompt}
          </option>
          {gate.disagreeReasons.map((reason) => (
            <option key={reason.key} value={reason.key}>
              {reason.label}
            </option>
          ))}
        </select>
        <input
          name="note"
          maxLength={NOTE_MAX_CHARS}
          placeholder="Note (optional)"
          aria-label="Note"
          className={input}
        />
        <div className="flex flex-wrap gap-1.5">
          <SubmitButton className={button} pendingLabel="Saving">
            Save disagreement
          </SubmitButton>
          {canOverride ? (
            <SubmitButton
              className={buttonPrimary}
              pendingLabel="Saving"
              formAction={disagreeAndMakeReelAction}
            >
              Disagree and make a reel
            </SubmitButton>
          ) : null}
        </div>
      </form>
    </details>
  )
}

/** Agree, disagree with a reason, clear, and the "make a reel anyway" override for one decision. */
export function GateReviewActions(props: Props) {
  const { gate, itemStatus, returnTo, keyHints } = props
  return (
    <div>
      <p className="mb-1.5 text-xs text-muted">{gate.reviewQuestion}</p>
      <div className="flex flex-wrap items-start gap-1.5">
        <form action={labelGateDecisionAction} data-gate-agree data-gate-form>
          <Hidden gate={gate} returnTo={returnTo} />
          <input type="hidden" name="label" value="agree" />
          <SubmitButton
            className={`${button} ${gate.label === 'agree' ? 'border-ok/50 text-ok' : ''}`}
            pendingLabel="Saving"
          >
            Agree{keyHints ? <Key>A</Key> : null}
          </SubmitButton>
        </form>
        <DisagreeForm {...props} />
        {gate.label ? (
          <form action={clearGateLabelAction} data-gate-form>
            <Hidden gate={gate} returnTo={returnTo} />
            <SubmitButton className={button} pendingLabel="Clearing">
              Clear
            </SubmitButton>
          </form>
        ) : null}
        {itemStatus === 'source_only' ? (
          <form action={makeReelAnywayAction} data-gate-form>
            <input type="hidden" name="itemId" value={gate.itemId} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <SubmitButton
              className={button}
              pendingLabel="Sending"
              confirm="Make a reel from this item anyway? It goes back into the pipeline."
            >
              Make a reel anyway
            </SubmitButton>
          </form>
        ) : null}
      </div>
    </div>
  )
}
