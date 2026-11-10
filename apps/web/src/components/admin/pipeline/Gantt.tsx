import { shortDuration, type Timeline } from '@/lib/admin/pipeline'

const BAR_COLOR: Record<string, string> = {
  ok: 'bg-ok',
  failed: 'bg-danger',
  skipped: 'bg-faint',
  started: 'bg-info',
}
const STAGE_LABEL: Record<string, string> = {
  found: 'Found',
  summarized: 'Script written',
  embedded: 'Embedded',
  voiced: 'Narrated',
  rendered: 'Rendered',
  failed: 'Failed',
}

export function Gantt({ timeline }: { timeline: Timeline }) {
  if (!timeline.bars.length)
    return <p className="text-xs text-faint">No timed steps recorded yet.</p>
  const total = Math.max(timeline.totalMs, 1)
  return (
    <div>
      <ul className="space-y-1.5">
        {timeline.bars.map((bar, i) => (
          <li
            key={`${bar.label}-${i}`}
            className="grid grid-cols-[6.5rem_minmax(0,1fr)_3.5rem] items-center gap-2 text-xs"
          >
            <span className="truncate text-muted">
              {STAGE_LABEL[bar.label] ?? bar.label}
              {bar.attempt > 1 ? <span className="text-faint"> #{bar.attempt}</span> : null}
            </span>
            <span className="relative h-3 rounded-sm bg-raised" title={bar.error ?? undefined}>
              <span
                className={`absolute top-0 h-full rounded-sm ${BAR_COLOR[bar.outcome] ?? 'bg-muted'}`}
                style={{
                  left: `${(bar.startMs / total) * 100}%`,
                  width: `${Math.max(1.5, (bar.durationMs / total) * 100)}%`,
                }}
              />
            </span>
            <span className="text-right tabular-nums text-faint">
              {shortDuration(bar.durationMs)}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] text-faint">
        Total span {shortDuration(timeline.totalMs)}. Gaps between bars are time spent waiting in a
        queue.
      </p>
    </div>
  )
}
