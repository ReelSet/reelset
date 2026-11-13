'use client'

import type { FeedItemDto } from '@/lib/api-types'
import { ReelPanel } from './ReelPanel'
import { useReelDetails } from './useReelDetails'

/** Details panel for any reel on screen: TLDR, key facts, transcript and sources. */
export function ReelAbout({ item }: { item: FeedItemDto }) {
  const reel = useReelDetails(item.id)
  if (reel) return <ReelPanel key={reel.id} reel={reel} />
  return (
    <article className="flex flex-col gap-3 text-sm leading-relaxed text-muted">
      <h2 className="text-lg font-semibold leading-snug tracking-tight text-fg">{item.title}</h2>
      {item.tldr && <p className="text-fg/90">{item.tldr}</p>}
    </article>
  )
}
