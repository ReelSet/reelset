import type { Database } from '../db/client'
import { ItemStatus } from '../db/enums'
import { reelUrl, submitIndexNow, type IndexNowResult } from '../domain/indexnow'
import { errorFields, type Logger } from '../lib/logger'

// Bing barely crawls on its own, and ChatGPT search and Copilot lean on Bing: tell it the moment
// a reel is live. Failure only costs discovery speed, so this never throws.
export async function announceReel(
  db: Database,
  itemId: string,
  log: Logger,
  fetchImpl: typeof fetch = fetch,
): Promise<IndexNowResult | 'not_public'> {
  const l = log.child({ itemId })
  try {
    const item = await db
      .selectFrom('item')
      .select(['id', 'title'])
      .where('id', '=', itemId)
      .where('visibility', '=', 'public')
      .where('status', '=', ItemStatus.rendered)
      .executeTakeFirst()
    if (!item) {
      l.debug('indexnow skipped: reel not public and rendered')
      return 'not_public'
    }
    return await submitIndexNow([reelUrl(item)], l, fetchImpl)
  } catch (err) {
    l.warn(errorFields(err), 'indexnow announce failed (non-fatal)')
    return 'failed'
  }
}
