import Link from 'next/link'
import { ArrowRightIcon, SparkleIcon } from '@/components/ui/icons'

export function CreatePromo() {
  return (
    <Link
      href="/create"
      className="group flex w-80 shrink-0 items-center gap-3 rounded-md border border-line bg-surface/80 p-3 transition hover:border-accent/40 hover:bg-raised"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg">
        <SparkleIcon className="h-[18px] w-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">Make a reel from any link</span>
        <span className="block text-xs text-muted">10 free a month</span>
      </span>
      <ArrowRightIcon className="h-4 w-4 text-faint transition group-hover:translate-x-0.5 group-hover:text-accent" />
    </Link>
  )
}
