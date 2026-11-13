'use client'

import { useEffect, useState } from 'react'
import { ReelArticle } from '@/components/seo/ReelArticle'
import type { FeedItemDto } from '@/lib/api-types'
import type { ReelPageData } from '@/lib/seo/types'

type State = { id: string; reel: ReelPageData | null }

/** Details panel for any reel on screen: TLDR, key facts, transcript and sources. */
export function ReelAbout({ item }: { item: FeedItemDto }) {
  const [state, setState] = useState<State | null>(null)

  useEffect(() => {
    const ctl = new AbortController()
    fetch(`/api/reel/${item.id}`, { signal: ctl.signal })
      .then((res) => (res.ok ? (res.json() as Promise<ReelPageData>) : null))
      .then((reel) => setState({ id: item.id, reel }))
      .catch(() => {})
    return () => ctl.abort()
  }, [item.id])

  const reel = state?.id === item.id ? state.reel : null
  if (reel) return <ReelArticle reel={reel} />
  return (
    <article className="flex flex-col gap-3 text-sm leading-relaxed text-muted">
      <h2 className="text-lg font-semibold leading-snug tracking-tight text-fg">{item.title}</h2>
      {item.tldr && <p className="text-fg/90">{item.tldr}</p>}
    </article>
  )
}
