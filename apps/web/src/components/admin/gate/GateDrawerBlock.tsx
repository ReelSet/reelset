import { judgeItemNowAction } from '@/app/admin/(pipeline)/gate/actions'
import { Block, KV } from '@/components/admin/drawer/blocks'
import { SubmitButton } from '@/components/admin/SubmitButton'
import { button } from '@/components/admin/primitives'
import { fmtDate } from '@/lib/admin/format'
import {
  EXPLORED_HINT,
  GATE_MODE_COPY,
  JUDGE_NOW_NOTE,
  MANUAL_HINT,
  type GateView,
} from '@/lib/admin/gate-view'
import { Chip, DecidedBy, ReviewState, ScoreBar, SignalBars, VerdictSummary } from './GateBadges'
import { GateReviewActions } from './GateReviewActions'

type Props = {
  gate: GateView | null
  itemId: string
  itemStatus: string
  returnTo: string
  tz: string
}

const modeLabel = (mode: string) =>
  (GATE_MODE_COPY as Record<string, { label: string } | undefined>)[mode]?.label ?? mode

function Facts({ gate, tz }: { gate: GateView; tz: string }) {
  return (
    <dl className="space-y-1.5">
      <KV k="Decided by" v={<DecidedBy gate={gate} />} />
      <KV k="Mode" v={modeLabel(gate.mode)} />
      <KV k="Applied" v={gate.appliedNote ?? 'Yes'} />
      <KV k="Model" v={gate.model ?? '-'} />
      <KV k="Prompt version" v={gate.promptVersion} />
      <KV k="Decided" v={fmtDate(gate.decidedAt, tz)} />
    </dl>
  )
}

function JudgeNow({
  itemId,
  judged,
  returnTo,
}: {
  itemId: string
  judged: boolean
  returnTo: string
}) {
  return (
    <form action={judgeItemNowAction} className="space-y-1.5 rounded-md border border-line p-3">
      <input type="hidden" name="itemId" value={itemId} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <SubmitButton className={button} pendingLabel="Judging, up to a minute">
        {judged ? 'Judge again' : 'Judge this'}
      </SubmitButton>
      <p className="text-xs text-faint">{JUDGE_NOW_NOTE}</p>
    </form>
  )
}

function Judgement({ gate, itemStatus, returnTo, tz }: Props & { gate: GateView }) {
  const judged = gate.signals.some((signal) => signal.value !== null)
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <VerdictSummary gate={gate} />
        <ScoreBar gate={gate} />
        <span className="text-xs">
          <ReviewState gate={gate} />
        </span>
      </div>
      {gate.manual ? <p className="text-xs text-muted">{MANUAL_HINT}</p> : null}
      {gate.explored ? <p className="text-xs text-muted">{EXPLORED_HINT}</p> : null}
      {judged ? <SignalBars signals={gate.signals} /> : null}
      {gate.reasons.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {gate.reasons.map((reason) => (
            <Chip key={reason}>{reason}</Chip>
          ))}
        </div>
      ) : null}
      {gate.rationale ? (
        <p className="text-xs leading-relaxed text-muted">{gate.rationale}</p>
      ) : null}
      <Facts gate={gate} tz={tz} />
      <GateReviewActions gate={gate} itemStatus={itemStatus} returnTo={returnTo} />
    </>
  )
}

/** The newest gate judgement for the item (automatic or on demand) with its review actions, and a way to judge the item now. */
export function GateDrawerBlock(props: Props) {
  const { gate, itemId, returnTo } = props
  return (
    <Block title="Gate">
      <div className="space-y-3">
        {gate ? (
          <Judgement {...props} gate={gate} />
        ) : (
          <p className="text-xs text-faint">The gate has not judged this item.</p>
        )}
        <JudgeNow itemId={itemId} judged={gate !== null} returnTo={returnTo} />
      </div>
    </Block>
  )
}
