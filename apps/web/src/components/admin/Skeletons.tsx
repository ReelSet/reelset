import { Skeleton } from '@/components/ui/Skeleton'

export function TitleSkeleton() {
  return (
    <div className="mb-6" aria-hidden>
      <Skeleton className="h-6 w-40" />
      <Skeleton className="mt-2 h-3.5 w-72 max-w-full" />
    </div>
  )
}

export function StatsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rounded-md border border-line bg-surface px-4 py-3">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="mt-2.5 h-7 w-14" />
        </div>
      ))}
    </div>
  )
}

export function TableSkeleton({ rows = 8, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div aria-hidden className="overflow-hidden rounded-md border border-line bg-surface">
      <div className="flex gap-4 border-b border-line bg-raised/40 px-3 py-2.5">
        {Array.from({ length: cols }, (_, i) => (
          <Skeleton key={i} className={`h-3 ${i === 0 ? 'w-40 flex-1' : 'w-16'}`} />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex gap-4 border-b border-line/60 px-3 py-3 last:border-b-0">
          {Array.from({ length: cols }, (_, i) => (
            <Skeleton key={i} className={`h-3.5 ${i === 0 ? 'w-40 flex-1' : 'w-16'}`} />
          ))}
        </div>
      ))}
    </div>
  )
}

export function AdminPageSkeleton({
  stats = 0,
  rows = 8,
  cols = 5,
  filters = false,
}: {
  stats?: number
  rows?: number
  cols?: number
  filters?: boolean
}) {
  return (
    <div aria-busy aria-label="Loading">
      <TitleSkeleton />
      {stats > 0 && <StatsSkeleton count={stats} />}
      {filters && (
        <div className="mb-5 flex flex-col gap-3" aria-hidden>
          <Skeleton className="h-8 w-72 max-w-full" />
          <div className="flex gap-1.5">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-6 w-16 rounded-full" />
            ))}
          </div>
        </div>
      )}
      <TableSkeleton rows={rows} cols={cols} />
    </div>
  )
}
