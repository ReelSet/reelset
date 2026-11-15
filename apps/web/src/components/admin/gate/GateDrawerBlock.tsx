import { Block, KV } from '@/components/admin/drawer/blocks'
import { fmtDate } from '@/lib/admin/format'
import { EXPLORED_HINT, GATE_MODE_COPY, type GateView } from '@/lib/admin/gate-view'
import { Chip, DecidedBy, ReviewState, ScoreBar, SignalBars, VerdictSummary } from './GateBadges'
import { GateReviewActions } from './GateReviewActions'

type Props = { gate: GateView; itemStatus: string; returnTo: string; tz: string }

const modeLabel = (mode: string) =>
  (GATE_MODE_COPY as Record<string, { label: string } | undefined>)[mode]?.label ?? mode

function Facts({ gate, tz }: Pick<Props, 'gate' | 'tz'>) {
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

/** The item's current gate decision in the drawer: why it was made, what an admin said, and the review actions. */
export function GateDrawerBlock({ gate, itemStatus, returnTo, tz }: Props) {
  const judged = gate.signals.some((signal) => signal.value !== null)
  return (
    <Block title="Gate">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <VerdictSummary gate={gate} />
          <ScoreBar gate={gate} />
          <span className="text-xs">
            <ReviewState gate={gate} />
          </span>
        </div>
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
      </div>
    </Block>
  )
}
