'use client'

import { useEffect, useState } from 'react'
import { loadReelDetails, peekReelDetails } from '@/lib/client/reel-details-cache'
import type { ReelPageData } from '@/lib/seo/types'

type Fetched = { id: string; reel: ReelPageData | null }

const IDLE_FALLBACK_MS = 150

function whenIdle(run: () => void): () => void {
  if (typeof requestIdleCallback === 'function') {
    const handle = requestIdleCallback(run, { timeout: 1000 })
    return () => cancelIdleCallback(handle)
  }
  const handle = setTimeout(run, IDLE_FALLBACK_MS)
  return () => clearTimeout(handle)
}

type DetailsState = { reel: ReelPageData | null; failed: boolean }

/** Full details of one reel: instant from the shared cache, else fetched; `failed` once a fetch gave up. */
export function useReelDetailsState(itemId: string | undefined): DetailsState {
  const [fetched, setFetched] = useState<Fetched | null>(null)
  const cached = itemId ? peekReelDetails(itemId) : undefined

  useEffect(() => {
    if (!itemId || peekReelDetails(itemId)) return
    const ctl = new AbortController()
    void loadReelDetails(itemId, ctl.signal).then((reel) => {
      if (!ctl.signal.aborted) setFetched({ id: itemId, reel })
    })
    return () => ctl.abort()
  }, [itemId])

  if (cached) return { reel: cached, failed: false }
  if (fetched && fetched.id === itemId) return { reel: fetched.reel, failed: fetched.reel === null }
  return { reel: null, failed: false }
}

/** Full details of one reel, or null until they are available. */
export function useReelDetails(itemId: string | undefined): ReelPageData | null {
  return useReelDetailsState(itemId).reel
}

/** Warms the details cache for neighbouring reels once the browser is idle. */
export function usePrefetchReelDetails(ids: readonly string[], enabled: boolean) {
  const key = ids.join(',')
  useEffect(() => {
    if (!enabled || !key) return
    const ctl = new AbortController()
    const cancelIdle = whenIdle(() => {
      for (const id of key.split(',')) void loadReelDetails(id, ctl.signal)
    })
    return () => {
      cancelIdle()
      ctl.abort()
    }
  }, [key, enabled])
}
