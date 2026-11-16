import { passesGateForAutoPost, type GateLabel, type GateVerdict } from '@reelset/core'
import { fmtGateScore } from '@/lib/admin/gate-view'

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })

export function Dash() {
  return <span className="text-faint">-</span>
}

const isVerdict = (v: string | null): v is GateVerdict => v === 'reel' || v === 'source_only'
const isLabel = (v: string | null): v is GateLabel => v === 'agree' || v === 'disagree'

/** The newest automatic gate score, green when that decision clears the item for auto posting. */
export function GateCell({
  score,
  verdict,
  decidedBy,
  label,
}: {
  score: number | null
  verdict: string | null
  decidedBy: string | null
  label: string | null
}) {
  if (!isVerdict(verdict)) return <Dash />
  const reviewed = isLabel(label) ? label : null
  const passes = passesGateForAutoPost({ verdict, decidedBy: decidedBy ?? '', label: reviewed })
  const note =
    reviewed === 'agree'
      ? 'agreed'
      : reviewed === 'disagree'
        ? 'disagreed'
        : decidedBy === 'explore'
          ? 'explored'
          : null
  return (
    <span
      className="whitespace-nowrap tabular-nums"
      title={passes ? 'Passes the gate: can be auto posted' : 'Does not pass the gate'}
    >
      <span className={passes ? 'text-ok' : 'text-muted'}>
        {score === null ? (passes ? 'reel' : 'source only') : fmtGateScore(score)}
      </span>
      {note ? <span className="text-xs text-faint"> · {note}</span> : null}
    </span>
  )
}

export function IgViews({
  views,
  comments,
  permalink,
}: {
  views: number | null
  comments: number | null
  permalink: string | null
}) {
  if (!permalink) return <Dash />
  const label = views === null ? 'posted' : compact.format(views)
  return (
    <a
      href={permalink}
      target="_blank"
      rel="noreferrer"
      title={comments ? `${comments} comments · open on Instagram` : 'Open on Instagram'}
      className="text-info hover:underline"
    >
      {label}
    </a>
  )
}
