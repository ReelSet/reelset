import { Skeleton } from '@/components/ui/Skeleton'

export function Block({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="border-t border-line pt-4">
      <h3 className="mb-2.5 text-[11px] font-medium uppercase tracking-wider text-faint">
        {title}
      </h3>
      {children}
    </section>
  )
}

export function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-xs">
      <dt className="text-faint">{k}</dt>
      <dd className="min-w-0 truncate text-right tabular-nums">{v}</dd>
    </div>
  )
}

export function SkeletonKV({ count }: { count: number }) {
  return (
    <div className="space-y-2" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex items-center justify-between gap-4">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-3 w-14" />
        </div>
      ))}
    </div>
  )
}

export function DrawerError({ status, onRetry }: { status: number; onRetry: () => void }) {
  const message =
    status === 404
      ? 'This record no longer exists.'
      : status === 401 || status === 403
        ? 'Your admin session has expired. Reload the page to sign in again.'
        : 'Could not load the details.'
  return (
    <div role="alert" className="space-y-3 rounded-md border border-danger/30 bg-danger/5 p-3">
      <p className="text-xs text-danger">{message}</p>
      {status === 404 || status === 401 || status === 403 ? null : (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md border border-line-strong bg-raised px-2.5 py-1 text-xs transition hover:bg-hover"
        >
          Try again
        </button>
      )}
    </div>
  )
}
