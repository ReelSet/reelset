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
      <div className="flex flex-1 flex-col justify-center gap-4 pb-24">
        <Skeleton className="h-6 w-48 rounded-full" />
        <Skeleton className="h-10 w-5/6" />
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="mt-4 h-[58px] w-full rounded-[22px]" />
      </div>
    </div>
  )
}
