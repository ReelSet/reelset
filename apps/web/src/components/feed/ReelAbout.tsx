'use client'

import type { FeedItemDto } from '@/lib/api-types'
import { reelFromFeedItem } from '@/lib/seo/from-feed-item'
import { ReelPanel } from './ReelPanel'
import { useReelDetailsState } from './useReelDetails'

/** Details panel for any reel on screen: renders from the feed item at once, facts fill in when fetched. */
export function ReelAbout({ item }: { item: FeedItemDto }) {
  const { reel: loaded, failed } = useReelDetailsState(item.id)
  return (
    <ReelPanel
      key={item.id}
      reel={loaded ?? reelFromFeedItem(item)}
      factsPending={!loaded && !failed}
    />
  )
}
