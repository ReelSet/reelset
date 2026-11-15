import { stepperFor } from '@/lib/admin/pipeline'
import { Block, SkeletonKV } from '@/components/admin/drawer/blocks'
import { Skeleton } from '@/components/ui/Skeleton'
import { Stepper } from './Stepper'

const TIMELINE_ROWS = [
  { width: '30%', offset: '0%' },
  { width: '22%', offset: '30%' },
  { width: '18%', offset: '52%' },
  { width: '26%', offset: '70%' },
]

const SCRIPT_LINES = ['w-full', 'w-11/12', 'w-4/5', 'w-full', 'w-2/3', 'w-11/12']

function TimelineSkeleton() {
  return (
    <ul className="space-y-1.5" aria-hidden>
      {TIMELINE_ROWS.map((row, i) => (
        <li key={i} className="grid grid-cols-[6.5rem_minmax(0,1fr)_3.5rem] items-center gap-2">
          <Skeleton className="h-3 w-16" />
          <span className="relative h-3 rounded-sm bg-raised">
            <span
              className="absolute top-0 h-full animate-shimmer rounded-sm bg-hover"
              style={{ left: row.offset, width: row.width }}
            />
          </span>
          <Skeleton className="ml-auto h-3 w-8" />
        </li>
      ))}
    </ul>
  )
}

/** Mirrors the loaded layout (stepper, timeline bars, script, render, cost) so nothing jumps. */
export function ItemDrawerSkeleton({ status }: { status: string | undefined }) {
  return (
    <div className="space-y-5" role="status" aria-label="Loading item details">
      <Stepper steps={stepperFor(status ?? 'found')} />
      <Block title="Timeline">
        <TimelineSkeleton />
      </Block>
      <Block title="Script">
        <div className="space-y-2.5" aria-hidden>
          {SCRIPT_LINES.map((width, i) => (
            <Skeleton key={i} className={`h-3 ${width}`} />
          ))}
        </div>
      </Block>
      <Block title="Render">
        <SkeletonKV count={5} />
      </Block>
      <Block title="Cost">
        <SkeletonKV count={3} />
      </Block>
    </div>
  )
}
