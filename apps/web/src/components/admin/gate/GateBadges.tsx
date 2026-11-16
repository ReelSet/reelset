import type { GateVerdict } from '@reelset/core'
import {
  DECIDER_HINTS,
  DECIDER_LABELS,
  EXPLORED_HINT,
  EXPLORED_TAG,
  MANUAL_HINT,
  MANUAL_TAG,
  VERDICT_LABELS,
  fmtGateScore,
  type GateSignalView,
  type GateView,
} from '@/lib/admin/gate-view'

const PILL =
  'inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px]'

const VERDICT_TONE: Record<GateVerdict, string> = {
  reel: 'border-ok/30 bg-ok/10 text-ok',
  source_only: 'border-line-strong bg-raised text-muted',
}

export function VerdictPill({ verdict }: { verdict: GateVerdict }) {
  return <span className={`${PILL} ${VERDICT_TONE[verdict]}`}>{VERDICT_LABELS[verdict]}</span>
}

/** What the judge said, and for an explore row that the item was made into a reel anyway. */
export function VerdictSummary({
  gate,
}: {
  gate: Pick<GateView, 'judgeVerdict' | 'explored' | 'manual'>
}) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <VerdictPill verdict={gate.judgeVerdict} />
      {gate.explored ? (
        <span title={EXPLORED_HINT} className={`${PILL} border-info/30 bg-info/10 text-info`}>
          {EXPLORED_TAG}
        </span>
      ) : null}
      {gate.manual ? (
        <span title={MANUAL_HINT} className={`${PILL} border-warn/30 bg-warn/10 text-warn`}>
          {MANUAL_TAG}
        </span>
      ) : null}
    </span>
  )
}

/** Small neutral pill for reason phrases and other short tags. */
export function Chip({ children }: { children: React.ReactNode }) {
  return <span className={`${PILL} border-line text-muted`}>{children}</span>
}

export function DecidedBy({ gate }: { gate: Pick<GateView, 'decidedBy' | 'rule'> }) {
  const label = DECIDER_LABELS[gate.decidedBy] ?? gate.decidedBy
  return (
    <span title={DECIDER_HINTS[gate.decidedBy]} className="whitespace-nowrap">
      {label}
      {gate.rule ? <span className="text-faint"> · {gate.rule.replaceAll('_', ' ')}</span> : null}
    </span>
  )
}

/** Score as a number over a thin bar, with a tick where the threshold sits. */
export function ScoreBar({ gate }: { gate: Pick<GateView, 'score' | 'threshold' | 'scoreMax'> }) {
  const { score, threshold, scoreMax } = gate
  if (score === null) return <span className="text-faint">-</span>
  const passed = score >= threshold
  return (
    <div
      className="w-20"
      title={`Score ${fmtGateScore(score)} against a threshold of ${fmtGateScore(threshold)}`}
    >
      <div className="flex items-baseline justify-between tabular-nums">
        <span className={passed ? 'text-fg' : 'text-muted'}>{fmtGateScore(score)}</span>
        <span className="text-[11px] text-faint">/ {fmtGateScore(threshold)}</span>
      </div>
      <div className="relative mt-1 h-1 rounded-full bg-line">
        <div
          className={`h-1 rounded-full ${passed ? 'bg-ok' : 'bg-faint'}`}
          style={{ width: `${(score / scoreMax) * 100}%` }}
        />
        <span
          aria-hidden
          className="absolute -top-0.5 h-2 w-px bg-fg/70"
          style={{ left: `${(threshold / scoreMax) * 100}%` }}
        />
      </div>
    </div>
  )
}

export function SignalBars({ signals }: { signals: readonly GateSignalView[] }) {
  return (
    <ul className="space-y-1.5">
      {signals.map((signal) => (
        <li
          key={signal.key}
          className="grid grid-cols-[6rem_minmax(0,1fr)_1.5rem] items-center gap-2 text-xs"
        >
          <span className="text-faint">{signal.label}</span>
          <span className="h-1 rounded-full bg-line">
            <span className="block h-1 rounded-full bg-info" style={{ width: `${signal.pct}%` }} />
          </span>
          <span className="text-right tabular-nums">{signal.value ?? '-'}</span>
        </li>
      ))}
    </ul>
  )
}

/** What an admin said about the decision, or that nobody has yet. */
export function ReviewState({
  gate,
}: {
  gate: Pick<GateView, 'label' | 'labelReason' | 'labelNote' | 'decidedBy' | 'explored'>
}) {
  if (gate.label === 'agree') {
    return (
      <span className="text-ok">
        Agreed{gate.explored ? ': the reel was right, the judge was wrong to say no' : ''}
      </span>
    )
  }
  if (gate.label === 'disagree') {
    return (
      <span className="text-warn">
        Disagreed{gate.explored ? ': the judge was right to say no' : ''}
        {gate.labelReason ? ` · ${gate.labelReason}` : ''}
        {gate.labelNote ? <span className="block text-faint">{gate.labelNote}</span> : null}
      </span>
    )
  }
  if (gate.decidedBy === 'admin') return <span className="text-faint">Admin override</span>
  return <span className="text-faint">Needs review</span>
}
