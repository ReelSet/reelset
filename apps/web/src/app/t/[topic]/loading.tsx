import { Skeleton } from '@/components/ui/Skeleton'

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-5xl px-5 pb-20" aria-busy aria-label="Loading topic">
      <div className="mt-10">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="mt-3 h-8 w-48" />
        <Skeleton className="mt-3 h-4 w-80 max-w-full" />
      </div>
      <div className="mt-6 flex gap-2 overflow-hidden">
        {['w-16', 'w-24', 'w-28', 'w-24', 'w-24', 'w-20'].map((w, i) => (
          <Skeleton key={i} className={`h-9 shrink-0 rounded-full ${w}`} />
        ))}
      </div>
      <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {Array.from({ length: 10 }, (_, i) => (
          <Skeleton key={i} className="aspect-[9/16] rounded-md" />
        ))}
      </div>
    </div>
  )
}
