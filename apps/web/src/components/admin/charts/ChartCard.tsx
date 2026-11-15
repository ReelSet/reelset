export type LegendItem = { label: string; color: string; dashed?: boolean }

function Legend({ items }: { items: LegendItem[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="h-0 w-3.5 border-t-2"
            style={{ borderColor: item.color, borderStyle: item.dashed ? 'dashed' : 'solid' }}
          />
          {item.label}
        </li>
      ))}
    </ul>
  )
}

/** Titled surface for a chart with an optional legend and a right-aligned action slot. */
export function ChartCard({
  title,
  legend,
  aside,
  children,
}: {
  title: React.ReactNode
  legend?: LegendItem[]
  aside?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="rounded-md border border-line bg-surface p-4">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 space-y-1.5">
          <h2 className="text-[13px] font-medium text-fg">{title}</h2>
          {legend && <Legend items={legend} />}
        </div>
        {aside}
      </div>
      {children}
    </section>
  )
}
