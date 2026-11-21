import { shortId } from '@/lib/reel-url'

/** Every cached anonymous feed page; revalidated when an item leaves the feed. */
export const FEED_TAG = 'feed'

/** Cache entries of one reel (its /r/ page, OG image, focus card), keyed by the uuid's short id. */
export function reelTag(idOrShortId: string): string {
  return `reel:${shortId(idOrShortId)}`
}
