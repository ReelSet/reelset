import { Skeleton } from '@/components/ui/Skeleton'

export default function Loading() {
  return (
    <main className="grid min-h-dvh place-items-center px-5" aria-busy aria-label="Loading">
      <div className="w-full max-w-sm">
        <Skeleton className="h-11 w-11" />
        <Skeleton className="mt-6 h-8 w-64" />
        <Skeleton className="mt-3 h-4 w-full" />
        <Skeleton className="mt-8 h-12 w-full" />
        <Skeleton className="mt-3 h-11 w-full" />
      </div>
    </main>
  )
}
