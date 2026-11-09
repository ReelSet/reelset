export function EmptyState({
  icon,
  title,
  body,
  action,
  className = '',
}: {
  icon?: React.ReactNode
  title: string
  body?: string
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div className={`animate-fade-up flex flex-col items-center px-6 text-center ${className}`}>
      {icon && <div className="mb-3 text-faint">{icon}</div>}
      <p className="text-base font-semibold tracking-tight">{title}</p>
      {body && <p className="mx-auto mt-1 max-w-xs text-sm leading-relaxed text-muted">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}
