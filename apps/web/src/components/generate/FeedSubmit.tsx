'use client'

import Link from 'next/link'
import { useState } from 'react'
import { LocalTime } from '@/components/ui/LocalTime'
import type { ReelRequestDto } from '@/lib/generate/types'
import { ApiFailure, submitToFeed, withdrawFromFeed } from './api'

const PRIMARY =
  'inline-flex min-h-11 items-center justify-center rounded-full bg-accent px-5 text-sm font-semibold text-accent-fg transition hover:brightness-95 active:scale-95 disabled:opacity-60'
const SECONDARY =
  'inline-flex min-h-10 items-center justify-center rounded-full border border-line-strong px-4 text-sm font-medium transition hover:bg-raised active:scale-95 disabled:opacity-60'

type Props = { request: ReelRequestDto; onChange: (request: ReelRequestDto) => void }

function useFeedAction(id: string, onChange: Props['onChange']) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async (call: typeof submitToFeed) => {
    setBusy(true)
    setError(null)
    try {
      onChange((await call(id)).request)
    } catch (err) {
      setError(err instanceof ApiFailure ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, submit: () => run(submitToFeed), withdraw: () => run(withdrawFromFeed) }
}

/** Owner-only control for sending a finished reel to review, and taking it back out. */
export function FeedSubmit({ request, onChange }: Props) {
  const { busy, error, submit, withdraw } = useFeedAction(request.id, onChange)
  const publish = request.reel?.publish
  if (!request.reel || !publish?.owned) return null

  return (
    <section aria-label="Public feed" className="mt-5 rounded-lg border border-line bg-surface p-4">
      {publish.state === 'none' && (
        <>
          <p className="text-sm font-medium">Share it with everyone</p>
          <p className="mt-1 text-xs text-muted">
            Reels are reviewed before they appear in the public feed.
          </p>
          <button
            type="button"
            className={`${PRIMARY} mt-3 w-full`}
            disabled={busy}
            onClick={submit}
          >
            {busy ? 'Submitting...' : 'Submit to the feed'}
          </button>
        </>
      )}
      {publish.state === 'in_review' && (
        <>
          <p className="text-sm font-medium">In review</p>
          <p className="mt-1 text-xs text-muted">
            {publish.requestedAt ? (
              <>
                Submitted <LocalTime value={publish.requestedAt} style="datetime" />.{' '}
              </>
            ) : null}
            We will publish it if it fits.
          </p>
          <button type="button" className={`${SECONDARY} mt-3`} disabled={busy} onClick={withdraw}>
            Cancel submission
          </button>
        </>
      )}
      {publish.state === 'live' && (
        <>
          <p className="text-sm font-medium text-ok">Live in the feed</p>
          {request.reel.pageUrl && (
            <Link href={request.reel.pageUrl} className="mt-1 block text-xs text-muted underline">
              View the public page
            </Link>
          )}
          <button type="button" className={`${SECONDARY} mt-3`} disabled={busy} onClick={withdraw}>
            Remove from feed
          </button>
        </>
      )}
      {publish.state === 'rejected' && (
        <>
          <p className="text-sm font-medium text-danger">Not accepted</p>
          {publish.note && <p className="mt-1 text-xs text-muted">{publish.note}</p>}
          <p className="mt-1 text-xs text-muted">
            Your reel stays private. You can submit it again.
          </p>
          <button type="button" className={`${SECONDARY} mt-3`} disabled={busy} onClick={submit}>
            {busy ? 'Submitting...' : 'Submit again'}
          </button>
        </>
      )}
      {error && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      )}
    </section>
  )
}
