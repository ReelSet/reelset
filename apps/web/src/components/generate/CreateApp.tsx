'use client'

import { useCallback, useEffect, useState } from 'react'
import { Skeleton } from '@/components/ui/Skeleton'
import type { CreditsDto, ReelRequestDto } from '@/lib/generate/types'
import { isOpen, listRequests } from './api'
import { Composer } from './Composer'
import { RequestList } from './RequestList'
import { usePolling } from './usePolling'

/** Signed-in /create: composer on top, live list of the viewer's requests underneath. */
export function CreateApp() {
  const [requests, setRequests] = useState<ReelRequestDto[] | null>(null)
  const [credits, setCredits] = useState<CreditsDto | null>(null)
  const [loadError, setLoadError] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const res = await listRequests()
      setRequests(res.requests)
      setCredits(res.credits)
      setLoadError(false)
    } catch {
      setLoadError(true)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  usePolling(refresh, Boolean(requests?.some(isOpen)))

  return (
    <>
      <Composer
        credits={credits}
        onCreated={(request, c) => {
          setCredits(c)
          setRequests((prev) => [request, ...(prev ?? []).filter((r) => r.id !== request.id)])
        }}
      />
      <section className="mx-auto mt-12 w-full max-w-2xl" aria-labelledby="your-reels">
        <h2
          id="your-reels"
          className="mb-3 text-xs font-medium uppercase tracking-wider text-faint"
        >
          Your reels
        </h2>
        {requests === null && !loadError && (
          <div className="flex flex-col gap-2.5" aria-busy aria-label="Loading your reels">
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-28 w-full" />
          </div>
        )}
        {loadError && requests === null && (
          <p role="alert" className="text-sm text-muted">
            Could not load your reels.{' '}
            <button type="button" onClick={() => void refresh()} className="text-accent underline">
              Retry
            </button>
          </p>
        )}
        {requests?.length === 0 && (
          <p className="rounded-md border border-dashed border-line-strong px-4 py-8 text-center text-sm text-muted">
            Nothing yet. Paste a link above and your first reel shows up here.
          </p>
        )}
        {requests && requests.length > 0 && <RequestList requests={requests} />}
      </section>
    </>
  )
}
