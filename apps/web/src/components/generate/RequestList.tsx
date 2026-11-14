import { PlayIcon } from '@/components/ui/icons'
import { SourceDot } from '@/components/ui/sources'
import type { ReelRequestDto } from '@/lib/generate/types'
import { detectSource, displayUrl } from './detect'
import { friendlyError, timeAgo } from './format'
import { CompactStepper } from './Stepper'

function Row({ r }: { r: ReelRequestDto }) {
  const first = r.urls[0]
  const title = r.reel?.title ?? (first ? displayUrl(first) : 'Reel')
  const sources = [...new Set(r.urls.map((u) => detectSource(u).source))]
  return (
    <li>
      <a
        href={`/create/${r.id}`}
        className="group flex gap-3 rounded-md border border-line bg-surface p-3 transition hover:border-line-strong hover:bg-raised active:scale-[0.995]"
      >
        <div className="relative aspect-[9/16] w-14 shrink-0 overflow-hidden rounded-sm bg-raised">
          {r.reel?.posterUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={r.reel.posterUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-faint">
              <PlayIcon className="h-5 w-5" />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="line-clamp-2 text-sm font-medium leading-snug">{title}</p>
            <span aria-hidden className="text-faint transition group-hover:text-fg">
              →
            </span>
          </div>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-faint">
            {sources.map((s) => (
              <SourceDot key={s} source={s} />
            ))}
            {r.urls.length} link{r.urls.length > 1 ? 's' : ''} · {timeAgo(r.createdAt)}
            {r.via === 'mcp' && ' · via MCP'}
          </p>
          <div className="mt-3">
            {r.status === 'failed' ? (
              <p className="text-xs text-danger">{friendlyError(r.error)}</p>
            ) : r.status === 'done' ? (
              <p className="text-xs text-ok">
                Ready
                {r.reel?.visibility === 'private' && <span className="text-faint"> · Private</span>}
              </p>
            ) : (
              <CompactStepper request={r} />
            )}
          </div>
        </div>
      </a>
    </li>
  )
}

export function RequestList({ requests }: { requests: ReelRequestDto[] }) {
  return (
    <ul className="flex flex-col gap-2.5">
      {requests.map((r) => (
        <Row key={r.id} r={r} />
      ))}
    </ul>
  )
}
