'use client'

import { useEffect, useState } from 'react'
import type { ReelPageData } from '@/lib/seo/types'

type State = { id: string; reel: ReelPageData | null }

/** Full details (facts, transcript, sources) of one reel from /api/reel/[id]; null while loading. */
export function useReelDetails(itemId: string | undefined, enabled = true): ReelPageData | null {
  const [state, setState] = useState<State | null>(null)

  useEffect(() => {
    if (!itemId || !enabled) return
    const ctl = new AbortController()
    fetch(`/api/reel/${itemId}`, { signal: ctl.signal })
      .then((res) => (res.ok ? (res.json() as Promise<ReelPageData>) : null))
      .then((reel) => setState({ id: itemId, reel }))
      .catch(() => {})
    return () => ctl.abort()
  }, [itemId, enabled])

  return state && state.id === itemId ? state.reel : null
}
