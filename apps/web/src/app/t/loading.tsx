import { Skeleton } from '@/components/ui/Skeleton'

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-5xl px-5 pb-20" aria-busy aria-label="Loading topics">
      <div className="mt-10 lg:mt-12">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="mt-3 h-4 w-72 max-w-full" />
      </div>
      <Skeleton className="mt-6 h-11 w-full rounded-full" />
      <div className="no-scrollbar mt-3 flex gap-2 overflow-hidden">
        {['w-16', 'w-20', 'w-24', 'w-20', 'w-24', 'w-20'].map((w, i) => (
          <Skeleton key={i} className={`h-9 shrink-0 rounded-full ${w}`} />
        ))}
      </div>
      <div className="mt-8 flex flex-col gap-10">
        {[0, 1].map((s) => (
          <div key={s}>
            <Skeleton className="h-5 w-40" />
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-5">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="aspect-[9/16] rounded-md" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
