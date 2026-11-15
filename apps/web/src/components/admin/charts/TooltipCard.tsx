export type TooltipRow = {
  label: string
  value: string
  color: string
  muted?: boolean
}

/** Dark hover card shared by every chart: a title line plus one colored row per series. */
export function TooltipCard({ title, rows }: { title: string; rows: TooltipRow[] }) {
  return (
    <div className="min-w-36 rounded-md border border-line-strong bg-bg/95 px-3 py-2 text-xs shadow-xl backdrop-blur">
      <p className="mb-1.5 font-medium text-fg">{title}</p>
      <ul className="space-y-1">
        {rows.map((row) => (
          <li key={row.label} className="flex items-center justify-between gap-4">
            <span
              className={`flex items-center gap-1.5 ${row.muted ? 'text-faint' : 'text-muted'}`}
            >
              <span
                aria-hidden
                className="size-2 rounded-full"
                style={{ background: row.color, opacity: row.muted ? 0.5 : 1 }}
              />
              {row.label}
            </span>
            <span className={`tabular-nums ${row.muted ? 'text-muted' : 'font-medium text-fg'}`}>
              {row.value}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
