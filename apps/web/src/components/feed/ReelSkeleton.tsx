import { Skeleton } from '@/components/ui/Skeleton'

export function ReelSkeleton() {
  return (
    <div className="absolute inset-0 bg-surface" aria-busy aria-label="Loading reels">
      <div className="absolute inset-x-0 bottom-0 flex flex-col gap-3 px-4 pb-8 pr-20">
        <Skeleton className="h-6 w-28 rounded-full bg-white/10" />
        <Skeleton className="h-5 w-5/6 bg-white/10" />
        <Skeleton className="h-5 w-2/3 bg-white/10" />
        <Skeleton className="h-3.5 w-full bg-white/5" />
      </div>
      <div className="absolute bottom-8 right-3 flex flex-col gap-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-11 w-11 rounded-full bg-white/10" />
        ))}
      </div>
    </div>
  )
}
