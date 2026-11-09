import { Skeleton } from '@/components/ui/Skeleton'

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-2xl px-5 pb-16" aria-busy aria-label="Loading profile">
      <div className="flex items-center justify-between pt-safe">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-8 w-20 rounded-full" />
      </div>
      <div className="mt-10 flex items-start justify-between">
        <div>
          <Skeleton className="h-8 w-44" />
          <Skeleton className="mt-2 h-4 w-52" />
        </div>
        <Skeleton className="h-9 w-24 rounded-full" />
      </div>
      <div className="mt-8 flex gap-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-7 w-20 rounded-full" />
        ))}
      </div>
      <div className="mt-10 grid grid-cols-3 gap-2 sm:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="aspect-[9/16]" />
        ))}
      </div>
    </div>
  )
}
