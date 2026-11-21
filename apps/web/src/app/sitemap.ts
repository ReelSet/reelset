import type { MetadataRoute } from 'next'
import { errorFields } from '@reelset/core'
import { buildSitemap, groupTopics } from '@/lib/seo/feeds'
import { getDb } from '@/server/db'
import { mediaBaseUrl } from '@/server/env'
import { routeLog } from '@/server/logger'
import { listSitemapReels, listTopicLabels, loadRetentionDays } from '@/server/seo-queries'

export const revalidate = 3600

// Well under the 50,000 URL limit of one sitemap file.
const SITEMAP_REELS = 20_000

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const log = routeLog('sitemap')
  const db = getDb()
  try {
    const [reels, labels, retentionDays] = await Promise.all([
      listSitemapReels(db, mediaBaseUrl(), SITEMAP_REELS),
      listTopicLabels(db),
      loadRetentionDays(db, log),
    ])
    const map = buildSitemap({ reels, topics: groupTopics(labels), retentionDays, now: new Date() })
    log.debug({ urls: map.length, reels: reels.length }, 'sitemap built')
    return map
  } catch (err) {
    log.error(errorFields(err), 'sitemap failed')
    // At runtime a throw keeps serving the last good sitemap; a build without a database ships
    // the static pages and the first revalidation fills in the reels.
    if (process.env.NEXT_PHASE === 'phase-production-build') {
      return buildSitemap({ reels: [], topics: [], retentionDays: 0, now: new Date() })
    }
    throw err
  }
}
