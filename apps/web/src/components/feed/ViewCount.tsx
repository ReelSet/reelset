import { PlaysIcon } from '@/components/ui/icons'
import { formatCount, visibleCount, type CountRule } from '@/lib/counts'

/** Play-triangle + count, the way Instagram and TikTok show plays. Hidden below the rule. */
export function ViewCount({
  count,
  rule,
  className = '',
}: {
  count: number
  rule: CountRule
  className?: string
}) {
  const shown = visibleCount(count, rule)
  if (shown === null) return null
  const text = formatCount(shown)
  return (
    <span
      title={`${shown.toLocaleString()} views`}
      className={`inline-flex shrink-0 items-center gap-1 tabular-nums ${className}`}
    >
      <PlaysIcon className="h-3.5 w-3.5" />
      <span aria-hidden>{text}</span>
      <span className="sr-only">{text} views</span>
    </span>
  )
}
