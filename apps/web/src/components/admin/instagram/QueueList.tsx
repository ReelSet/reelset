import Link from 'next/link'
import { Ago } from '@/components/admin/pipeline/Elapsed'
import { cancelPostAction, deletePostAction } from '@/app/admin/instagram/actions'
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
}

export function QueueList({
  rows,
  returnTo,
  hrefFor,
}: {
  rows: QueueRow[]
  returnTo: string
  hrefFor: (itemId: string) => string
}) {
  return (
    <ul className="overflow-hidden rounded-md border border-line bg-surface">
      {rows.map((row) => {
        const badge = postBadge(row.status, row.delete_requested_at !== null)
        return (
          <li
            key={row.id}
            className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line/60 px-3 py-2.5 last:border-b-0"
          >
            <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${badge.className}`}>
              {badge.label}
            </span>
            <div className="min-w-0 flex-1 basis-48">
              <Link
                href={hrefFor(row.item_id)}
                scroll={false}
                className="line-clamp-1 font-medium hover:underline"
              >
                {row.title}
              </Link>
              <p className="text-xs text-faint">
                {row.posted_at ? 'posted ' : 'queued '}
                <Ago at={new Date(row.posted_at ?? row.created_at).toISOString()} />
              </p>
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
