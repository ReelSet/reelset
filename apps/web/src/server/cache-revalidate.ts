import { errorFields, type Logger } from '@reelset/core'
import { revalidateTag } from 'next/cache'
import { FEED_TAG, reelTag } from '@/lib/cache-tags'

// expire: 0 drops the entries now; the default profile would serve the taken-down page once more.
const NOW = { expire: 0 }

/** Drops the cached /r/ pages, OG images and anonymous feeds that may show these items. */
export function expireReels(itemIds: readonly string[], log: Logger): void {
  if (itemIds.length === 0) return
  try {
    for (const id of new Set(itemIds)) revalidateTag(reelTag(id), NOW)
    revalidateTag(FEED_TAG, NOW)
    log.info({ items: itemIds.length }, 'reel caches expired')
  } catch (err) {
    log.warn({ ...errorFields(err), items: itemIds.length }, 'reel cache expiry failed')
  }
}
