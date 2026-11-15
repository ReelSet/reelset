'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { Skeleton } from '@/components/ui/Skeleton'
import { DownloadIcon, LinkIcon, ShareIcon, SparkleIcon } from '@/components/ui/icons'
import { SourceDot } from '@/components/ui/sources'
import type { ReelRequestDto } from '@/lib/generate/types'
import { ApiFailure, getRequest, isOpen } from './api'
import { copyText } from './CopyButton'
import { detectSource, displayUrl } from './detect'
import { FeedSubmit } from './FeedSubmit'
import { friendlyError } from './format'
import { BigStepper } from './Stepper'
import { usePolling } from './usePolling'

const BTN =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-line-strong px-4 text-sm font-medium transition hover:bg-raised active:scale-95'

function Actions({ request }: { request: ReelRequestDto }) {
  const [note, setNote] = useState<string | null>(null)
  const reel = request.reel
  if (!reel) return null
  const link = reel.pageUrl
  const flash = (text: string) => {
    setNote(text)
    setTimeout(() => setNote(null), 2000)
  }
  return (
    <div className="mt-4 flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {reel.downloadUrl && (
          <a
            href={reel.downloadUrl}
            download={`reelset-${request.id.slice(0, 8)}.mp4`}
            className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-full bg-accent px-5 text-sm font-semibold text-accent-fg transition hover:brightness-95 active:scale-95"
          >
            <DownloadIcon className="h-4 w-4" />
            Download MP4
          </a>
        )}
        {link && (
          <>
            <button
              type="button"
              className={BTN}
              onClick={async () => flash((await copyText(link)) ? 'Link copied' : 'Could not copy')}
            >
              <LinkIcon className="h-4 w-4" />
              Copy link
            </button>
            <button
              type="button"
              className={BTN}
              onClick={async () => {
                if (typeof navigator.share === 'function') {
                  try {
                    await navigator.share({ title: reel.title ?? 'My reel', url: link })
                    return
                  } catch (err) {
                    if (err instanceof DOMException && err.name === 'AbortError') return
                  }
                }
                flash((await copyText(link)) ? 'Link copied' : 'Could not copy')
              }}
            >
              <ShareIcon className="h-4 w-4" />
              Share
            </button>
          </>
        )}
      </div>
      <p className="min-h-4 text-xs text-ok" role="status">
        {note}
      </p>
      {reel.publish.state !== 'live' && (
        <p className="text-xs text-faint">Private · only people with the link</p>
      )}
    </div>
  )
}

export function RequestStatus({ id }: { id: string }) {
  const [request, setRequest] = useState<ReelRequestDto | null>(null)
  const [error, setError] = useState<ApiFailure | null>(null)

  const refresh = useCallback(async () => {
    try {
      const res = await getRequest(id)
      setRequest(res.request)
      setError(null)
    } catch (err) {
      if (err instanceof ApiFailure) setError(err)
    }
  }, [id])

  useEffect(() => {
    void refresh()
  }, [refresh])

  usePolling(refresh, !error || error.code === 'network' ? !request || isOpen(request) : false)

  if (error && !request) {
    const missing = error.code === 'not_found' || error.status === 404
    return (
      <div className="rounded-lg border border-line bg-surface p-8 text-center">
        <p className="text-lg font-semibold">
          {missing ? 'Reel not found' : 'Could not load this reel'}
        </p>
        <p className="mt-1 text-sm text-muted">
          {missing ? 'It may belong to another account.' : error.message}
        </p>
        <Link
          href="/create"
          className="mt-5 inline-flex min-h-11 items-center rounded-full bg-accent px-5 text-sm font-semibold text-accent-fg"
        >
          Back to Create
        </Link>
      </div>
    )
  }
  if (!request) {
    return (
      <div aria-busy aria-label="Loading" className="flex flex-col gap-4">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  const failed = request.status === 'failed'
  const done = request.status === 'done' && request.reel
  const title = request.reel?.title ?? 'Your reel'

  return (
    <div className="grid gap-8 md:grid-cols-[minmax(0,1fr)_minmax(0,18rem)]">
      <div>
        <p className="text-xs font-medium uppercase tracking-wider text-faint" aria-live="polite">
          {done ? 'Ready' : failed ? 'Could not finish' : 'Making your reel'}
        </p>
        <h1 className="mt-1 text-[26px] font-semibold leading-tight tracking-tight [text-wrap:balance]">
          {done
            ? title
            : failed
              ? 'This one did not work out'
              : 'Hang tight, this takes a minute or two'}
        </h1>

        <ul className="mt-4 flex flex-wrap gap-1.5">
          {request.urls.map((u) => (
            <li
              key={u}
              className="flex max-w-full items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-xs"
            >
              <SourceDot source={detectSource(u).source} />
              <a
                href={u}
                target="_blank"
                rel="noopener noreferrer"
                className="min-w-0 truncate text-muted hover:text-fg"
              >
                {displayUrl(u)}
              </a>
            </li>
          ))}
        </ul>

        {failed && (
          <div role="alert" className="mt-6 rounded-md border border-danger/30 bg-danger/10 p-4">
            <p className="text-sm font-medium text-danger">{friendlyError(request.error)}</p>
            <p className="mt-1 text-xs text-muted">
              {request.creditsCharged > 0
                ? 'Your credits were refunded. '
                : 'No credits were used. '}
              Try different links, or a page with more text on it.
            </p>
            <Link
              href="/create"
              className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-full bg-accent px-4 text-sm font-semibold text-accent-fg"
            >
              <SparkleIcon className="h-4 w-4" />
              Try again
            </Link>
          </div>
        )}

        <div className="mt-8 rounded-lg border border-line bg-surface p-5">
          <BigStepper request={request} />
        </div>
        {!done && !failed && (
          <p className="mt-3 text-xs text-faint">
            You can leave this page. Your reel keeps rendering and shows up under Your reels.
          </p>
        )}
        <Link href="/create" className="mt-6 inline-block text-sm text-muted hover:text-fg">
          ← All your reels
        </Link>
      </div>

      <div className="md:order-last">
        {done && request.reel ? (
          <div className="mx-auto w-full max-w-[18rem] animate-fade-up">
            <div className="aspect-[9/16] overflow-hidden rounded-lg border border-line bg-black">
              {request.reel.videoUrl ? (
                <video
                  src={request.reel.videoUrl}
                  poster={request.reel.posterUrl ?? undefined}
                  controls
                  playsInline
                  preload="metadata"
                  className="h-full w-full object-contain"
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                request.reel.posterUrl && (
                  <img src={request.reel.posterUrl} alt="" className="h-full w-full object-cover" />
                )
              )}
            </div>
            <Actions request={request} />
            <FeedSubmit request={request} onChange={setRequest} />
          </div>
        ) : (
          <div
            aria-hidden
            className="mx-auto flex aspect-[9/16] w-full max-w-[18rem] items-center justify-center rounded-lg border border-dashed border-line-strong bg-surface"
          >
            <span className="animate-shimmer text-xs text-faint">
              {failed ? 'No video' : 'Your reel appears here'}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
