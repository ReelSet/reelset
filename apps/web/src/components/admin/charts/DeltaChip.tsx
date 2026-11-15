import { formatDelta } from '@/lib/admin/stats'

type Props = { pct: number | null; tone: 'growth' | 'neutral' }

function toneClass(pct: number, tone: Props['tone']): string {
  if (tone === 'neutral' || pct === 0) return 'bg-white/[0.06] text-muted'
  return pct > 0 ? 'bg-ok/10 text-ok' : 'bg-danger/10 text-danger'
}

function Arrow({ up }: { up: boolean }) {
  return (
    <svg viewBox="0 0 10 10" className="size-2.5" fill="currentColor" aria-hidden>
      <path d={up ? 'M5 1.5 9 8H1z' : 'M5 8.5 1 2h8z'} />
    </svg>
  )
}

/** % change vs the previous period; neutral and dashed when there is nothing to compare to. */
export function DeltaChip({ pct, tone }: Props) {
  if (pct === null) {
    return (
      <span
        title="No data in the previous period"
        className="rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[11px] tabular-nums text-faint"
      >
        --
      </span>
    )
  }
  return (
    <span
      title="Change vs the previous period"
      className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-medium tabular-nums ${toneClass(pct, tone)}`}
    >
      {pct !== 0 && <Arrow up={pct > 0} />}
      {formatDelta(pct)}
    </span>
  )
}
