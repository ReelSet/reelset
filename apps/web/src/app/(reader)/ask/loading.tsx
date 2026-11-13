import { Skeleton } from '@/components/ui/Skeleton'

export default function Loading() {
  return (
    <div
      className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-5"
      aria-busy
      aria-label="Loading"
    >
      <div className="flex items-center justify-between pt-safe">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-8 w-20 rounded-full" />
      </div>
      <div className="flex flex-1 flex-col gap-6 pt-8 lg:justify-center lg:pb-24">
        <div className="flex flex-col gap-4">
          <Skeleton className="h-6 w-48 rounded-full" />
          <Skeleton className="h-10 w-5/6" />
          <Skeleton className="h-10 w-2/3" />
        </div>
        <div className="flex flex-col gap-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[50px] w-full" />
          ))}
        </div>
        <Skeleton className="mt-auto mb-2 h-[58px] w-full shrink-0 rounded-[22px] max-lg:sticky max-lg:bottom-[calc(3.5rem+env(safe-area-inset-bottom)+0.5rem)] lg:mt-2" />
      </div>
    </div>
  )
}
