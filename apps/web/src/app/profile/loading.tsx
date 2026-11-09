import { Skeleton } from '@/components/ui/Skeleton'

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-2xl px-5 pb-16" aria-busy aria-label="Loading profile">
      <div className="flex items-center justify-between pt-safe">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-8 w-20 rounded-full" />
      </div>
      <div className="mt-10 flex items-center gap-4">
        <Skeleton className="h-16 w-16 rounded-full" />
        <div>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="mt-2 h-4 w-32" />
        </div>
      </div>
      <div className="mt-10 flex flex-wrap gap-2">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-8 w-20 rounded-full" />
        ))}
      </div>
      <Skeleton className="mt-10 h-48 w-full" />
      <div className="mt-10 grid grid-cols-3 gap-2">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="aspect-[9/16]" />
        ))}
      </div>
    </div>
  )
}
