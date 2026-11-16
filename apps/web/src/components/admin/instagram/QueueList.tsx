import { ItemLink } from '@/components/admin/drawer/DrawerLink'
import { isLostLookupPending } from '@reelset/core'
import { Ago } from '@/components/admin/pipeline/Elapsed'
import { cancelPostAction, deletePostAction, retryPostAction } from '@/app/admin/instagram/actions'
import { statsParts } from '@/lib/instagram/stats'
import { postBadge } from '@/lib/instagram/status'
import { ConfirmForm } from './ConfirmForm'
import { ArrowUpRightIcon } from '@/components/ui/icons'

export type QueueRow = {
  id: string
  item_id: string
  title: string
  status: string
  permalink: string | null
  error: string | null
  created_at: Date | string
  posted_at: Date | string | null
  delete_requested_at: Date | string | null
  started_at?: Date | string | null
  like_count: number | null
  comments_count: number | null
  view_count: number | null
  stats_at: Date | string | null
  etaAt?: Date | null
}

function etaLabel(at: Date, now: Date): string {
  const minutes = Math.ceil((at.getTime() - now.getTime()) / 60_000)
  return minutes <= 1 ? 'Goes out any moment now' : `Goes out in about ${minutes} min`
}

export function QueueList({
  rows,
  now,
  returnTo,
  hrefFor,
}: {
  rows: QueueRow[]
  now: Date
  returnTo: string
  hrefFor: (itemId: string) => string
}) {
  return (
    <ul className="overflow-hidden rounded-md border border-line bg-surface">
      {rows.map((row) => {
        const lookupPending =
          row.status === 'failed' &&
          isLostLookupPending(row.error, row.started_at ? new Date(row.started_at) : null, now)
        const badge = postBadge(row.status, row.delete_requested_at !== null)
        const stats = row.posted_at && row.stats_at ? statsParts(row) : []
        return (
          <li
            key={row.id}
            className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line/60 px-3 py-2.5 last:border-b-0"
          >
            <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${badge.className}`}>
              {badge.label}
            </span>
            <div className="min-w-0 flex-1 basis-48">
              <ItemLink
                id={row.item_id}
                title={row.title}
                href={hrefFor(row.item_id)}
                className="line-clamp-1 font-medium hover:underline"
              >
                {row.title}
              </ItemLink>
              <p className="text-xs text-faint">
                {row.posted_at ? 'posted ' : 'queued '}
                <Ago at={new Date(row.posted_at ?? row.created_at).toISOString()} />
              </p>
              {stats.length > 0 && row.stats_at ? (
                <p className="mt-0.5 text-xs text-muted">
                  <span className="tabular-nums">{stats.join(' · ')}</span>
                  <span className="text-faint">
                    {' · '}stats updated <Ago at={new Date(row.stats_at).toISOString()} />
                  </span>
                </p>
              ) : null}
              {row.status === 'queued' && row.etaAt ? (
                <p className="mt-0.5 text-xs text-muted">
                  {etaLabel(row.etaAt, now)} (posts are spaced 10 min apart)
                </p>
              ) : null}
              {row.status === 'posting' ? (
                <p className="mt-0.5 text-xs text-info">Uploading to Instagram now</p>
              ) : null}
              {row.error ? <p className="mt-0.5 text-xs text-danger">{row.error}</p> : null}
            </div>
            <div className="flex items-center gap-3">
              {row.permalink ? (
                <a
                  href={row.permalink}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-info hover:underline"
                >
                  Open on Instagram <ArrowUpRightIcon className="h-3 w-3" />
                </a>
              ) : null}
              {row.status === 'queued' ? (
                <ConfirmForm
                  action={cancelPostAction}
                  fields={{ postId: row.id, returnTo }}
                  triggerLabel="Cancel"
                  title="Cancel this queued post?"
                  confirmLabel="Cancel post"
                  pendingLabel="Cancelling"
                >
                  <p className="text-[13px] text-muted">{row.title} will not be posted.</p>
                </ConfirmForm>
              ) : null}
              {lookupPending ? (
                <span className="text-xs text-muted">Checking Instagram…</span>
              ) : null}
              {row.status === 'failed' && !lookupPending ? (
                <ConfirmForm
                  action={retryPostAction}
                  fields={{ postId: row.id, returnTo }}
                  triggerLabel="Retry"
                  title="Retry this post?"
                  confirmLabel="Queue again"
                  pendingLabel="Queuing"
                >
                  <p className="text-[13px] text-muted">
                    &ldquo;{row.title}&rdquo; goes back in the queue and posts within about 5
                    minutes. Instagram may be reviewing the account, so retry one at a time.
                  </p>
                </ConfirmForm>
              ) : null}
              {row.status === 'posted' && !row.delete_requested_at ? (
                <ConfirmForm
                  action={deletePostAction}
                  fields={{ postId: row.id, returnTo }}
                  triggerLabel="Delete from Instagram"
                  title="Delete this post from Instagram?"
                  confirmLabel="Delete post"
                  pendingLabel="Queuing delete"
                  danger
                >
                  <p className="text-[13px] text-muted">
                    This removes the live reel for &ldquo;{row.title}&rdquo; from your Instagram
                    account. It cannot be undone.
                  </p>
                </ConfirmForm>
              ) : null}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
