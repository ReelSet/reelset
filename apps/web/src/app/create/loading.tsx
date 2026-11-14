import { Skeleton } from '@/components/ui/Skeleton'

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-2xl px-5 pt-20" aria-busy aria-label="Loading">
      <Skeleton className="mx-auto h-12 w-4/5" />
      <Skeleton className="mx-auto mt-6 h-36 w-full" />
    </div>
  )
}
