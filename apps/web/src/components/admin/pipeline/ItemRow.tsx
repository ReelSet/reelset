import Link from 'next/link'
import { SourceDot, sourceMeta } from '@/components/ui/sources'
import { activeStepKey, etaHint, stepperFor, type StageMedians } from '@/lib/admin/pipeline'
import { Ago, Elapsed } from './Elapsed'
import { ErrorLine } from './ErrorLine'
import { QuickRetry } from './QuickRetry'
import { Stepper } from './Stepper'

export type RowItem = {
  id: string
  title: string
  status: string
  source: string
  attempts: number
  last_error: string | null
  queued_at: Date | string | null
  status_changed_at: Date | string
  thumbnail: string | null
  last_ok_stage?: string | null
  render_status?: string | null
  render_started_at?: Date | string | null
  render_attempts?: number | null
}

const iso = (v: Date | string) => new Date(v).toISOString()

function Thumb({ src, title }: { src: string | null; title: string }) {
  return (
    <span className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-md border border-line bg-raised text-[10px] text-faint">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
        />
      ) : (
        title.slice(0, 2).toUpperCase()
      )}
    </span>
  )
}

function stepClock(item: RowItem): string {
  if (item.status === 'embedded' || item.status === 'voiced') {
    if (item.render_started_at && item.render_status === 'rendering')
      return iso(item.render_started_at)
  }
  const changed = iso(item.status_changed_at)
  const queued = item.queued_at ? iso(item.queued_at) : null
  return queued && queued > changed ? queued : changed
}

function waitingLabel(item: RowItem): string {
  if (item.status === 'embedded' || item.status === 'voiced') {
    return item.render_status === 'rendering' ? 'Rendering' : 'Waiting for a render slot'
  }
  if (item.status === 'found') return item.queued_at ? 'Writing script' : 'Waiting to be admitted'
  if (item.status === 'summarized') return 'Embedding'
  return item.status
}

export function InProgressRow({
  item,
  medians,
  detailHref,
  now,
}: {
  item: RowItem
  medians: StageMedians
  detailHref: string
  now: Date
}) {
  const since = stepClock(item)
  const key = item.render_status === 'rendering' ? 'render' : activeStepKey(item.status)
  const eta = etaHint(key, now.getTime() - new Date(since).getTime(), medians)
  const attempts = Math.max(item.attempts, item.render_attempts ?? 0)
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 border-b border-line/60 px-3 py-3 last:border-b-0 sm:grid-cols-[auto_minmax(0,1.3fr)_minmax(0,1fr)_auto] sm:items-center">
      <Thumb src={item.thumbnail} title={item.title} />
      <div className="min-w-0">
        <Link
          href={detailHref}
          scroll={false}
          className="line-clamp-2 font-medium leading-snug hover:underline"
        >
          {item.title}
        </Link>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-faint">
          <span className="inline-flex items-center gap-1.5">
            <SourceDot source={item.source} />
            {sourceMeta(item.source).label}
          </span>
          {attempts > 1 ? <span className="text-warn">attempt {attempts}</span> : null}
        </p>
      </div>
      <div className="col-span-2 sm:col-span-1">
        <Stepper steps={stepperFor(item.status)} compact />
      </div>
      <div className="col-span-2 flex items-baseline gap-2 text-xs sm:col-span-1 sm:flex-col sm:items-end sm:gap-0.5">
        <span className="text-muted">{waitingLabel(item)}</span>
        <span className="tabular-nums text-fg">
          <Elapsed since={since} />
        </span>
        {eta ? (
          <span className={eta.kind === 'slow' ? 'text-warn' : 'text-faint'}>{eta.label}</span>
        ) : null}
      </div>
    </li>
  )
}

const STATUS_BADGE: Record<string, string> = {
  rendered: 'text-ok',
  failed: 'text-danger',
  insufficient_source: 'text-warn',
}

export function RecentRow({
  item,
  detailHref,
  returnTo,
  renderMs,
}: {
  item: RowItem
  detailHref: string
  returnTo: string
  renderMs: number | null
}) {
  const failed = item.status === 'failed'
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 border-b border-line/60 px-3 py-3 last:border-b-0 md:grid-cols-[auto_minmax(0,1.4fr)_9rem_8rem] md:items-start">
      <Thumb src={item.thumbnail} title={item.title} />
      <div className="min-w-0 space-y-1">
        <Link
          href={detailHref}
          scroll={false}
          className="line-clamp-2 font-medium leading-snug hover:underline"
        >
          {item.title}
        </Link>
        <p className="flex flex-wrap items-center gap-x-2 text-xs text-faint">
          <span className="inline-flex items-center gap-1.5">
            <SourceDot source={item.source} />
            {sourceMeta(item.source).label}
          </span>
          {item.attempts > 1 ? <span>attempt {item.attempts}</span> : null}
        </p>
        {failed ? (
          <>
            <ErrorLine raw={item.last_error} />
            <QuickRetry
              itemId={item.id}
              lastOkStage={item.last_ok_stage ?? null}
              returnTo={returnTo}
            />
          </>
        ) : null}
      </div>
      <div className="col-span-2 md:col-span-1">
        <Stepper steps={stepperFor(item.status, item.last_ok_stage)} compact />
      </div>
      <div className="col-span-2 flex items-baseline gap-2 text-xs md:col-span-1 md:flex-col md:items-end md:gap-0.5">
        <span className={STATUS_BADGE[item.status] ?? 'text-muted'}>
          {item.status === 'insufficient_source'
            ? 'skipped'
            : item.status === 'summarized'
              ? 'scripted'
              : item.status}
        </span>
        <span className="text-faint">
          <Ago at={iso(item.status_changed_at)} />
        </span>
        {renderMs ? (
          <span className="text-faint">render {Math.round(renderMs / 1000)}s</span>
        ) : null}
      </div>
    </li>
  )
}
