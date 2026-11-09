import { EmptyState } from './EmptyState'
import { WarnIcon } from './icons'

export const retryBtn =
  'rounded-full bg-accent px-6 py-2.5 text-sm font-medium text-accent-fg transition active:scale-95'
export const quietBtn =
  'rounded-full border border-line px-5 py-2.5 text-sm text-muted transition hover:bg-raised hover:text-fg active:scale-95'

export function ErrorState({
  title = 'Something went wrong',
  body = 'That was on us. Try again in a moment.',
  onRetry,
  retryLabel = 'Try again',
  digest,
  className = '',
  children,
}: {
  title?: string
  body?: string
  onRetry?: () => void
  retryLabel?: string
  digest?: string
  className?: string
  children?: React.ReactNode
}) {
  return (
    <div role="alert" className={className}>
      <EmptyState
        icon={<WarnIcon className="h-9 w-9 text-danger" />}
        title={title}
        body={body}
        action={
          (onRetry || children) && (
            <div className="flex items-center justify-center gap-3">
              {onRetry && (
                <button type="button" onClick={onRetry} className={retryBtn}>
                  {retryLabel}
                </button>
              )}
              {children}
            </div>
          )
        }
      />
      {digest && <p className="mt-4 text-center font-mono text-[11px] text-faint">ref {digest}</p>}
    </div>
  )
}
