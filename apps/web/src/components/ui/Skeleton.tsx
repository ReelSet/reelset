export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden className={`animate-shimmer rounded-md bg-raised ${className}`} />
}

export function SkeletonText({
  lines = 3,
  className = '',
}: {
  lines?: number
  className?: string
}) {
  const widths = ['w-full', 'w-11/12', 'w-2/3', 'w-4/5']
  return (
    <div className={`flex flex-col gap-2.5 ${className}`}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={`h-4 ${widths[i % widths.length]}`} />
      ))}
    </div>
  )
}
