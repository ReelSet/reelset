import { Block, SkeletonKV } from '@/components/admin/drawer/blocks'
import { Skeleton } from '@/components/ui/Skeleton'

function RowSkeleton() {
  return (
    <div className="space-y-2 rounded-md border border-line px-3 py-2" aria-hidden>
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-3 w-4/5" />
    </div>
  )
}

/** Mirrors the loaded user layout: identity, key numbers, grant form, request and ledger lists. */
export function UserDrawerSkeleton() {
  return (
    <div className="space-y-5" role="status" aria-label="Loading user details">
      <div className="flex items-center gap-3" aria-hidden>
        <Skeleton className="h-12 w-12 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-44" />
        </div>
      </div>
      <SkeletonKV count={6} />
      <Block title="Grant credits">
        <Skeleton className="h-8 w-56" />
      </Block>
      <Block title="Recent reel requests">
        <div className="space-y-2">
          <RowSkeleton />
          <RowSkeleton />
        </div>
      </Block>
      <Block title="Credit ledger">
        <SkeletonKV count={3} />
      </Block>
    </div>
  )
}
