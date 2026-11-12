import type { MetadataRoute } from 'next'
import { errorFields } from '@reelset/core'
import { buildSitemap, groupTopics } from '@/lib/seo/feeds'
import { getDb } from '@/server/db'
import { mediaBaseUrl } from '@/server/env'
import { routeLog } from '@/server/logger'
import { listReelSummaries, listTopicLabels, loadRetentionDays } from '@/server/seo-queries'

export const dynamic = 'force-dynamic'

// Well under the 50,000 URL limit of one sitemap file.
const SITEMAP_REELS = 20_000

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const log = routeLog('sitemap')
  const db = getDb()
  try {
    const [reels, labels, retentionDays] = await Promise.all([
      listReelSummaries(db, mediaBaseUrl(), { limit: SITEMAP_REELS }),
      listTopicLabels(db),
      loadRetentionDays(db, log),
    ])
    const map = buildSitemap({ reels, topics: groupTopics(labels), retentionDays, now: new Date() })
    log.info({ urls: map.length, reels: reels.length }, 'sitemap built')
    return map
  } catch (err) {
    log.error(errorFields(err), 'sitemap failed')
    throw err
  }
}
