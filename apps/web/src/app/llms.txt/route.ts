import { errorFields } from '@reelset/core'
import { buildLlmsTxt, groupTopics } from '@/lib/seo/feeds'
import { getDb } from '@/server/db'
import { mediaBaseUrl } from '@/server/env'
import { routeLog } from '@/server/logger'
import { listReelSummaries, listTopicLabels } from '@/server/seo-queries'

export const dynamic = 'force-dynamic'

const LLMS_REELS = 100

export async function GET() {
  const log = routeLog('llms.txt')
  try {
    const db = getDb()
    const [reels, labels] = await Promise.all([
      listReelSummaries(db, mediaBaseUrl(), { limit: LLMS_REELS }),
      listTopicLabels(db),
    ])
    return new Response(buildLlmsTxt({ reels, topics: groupTopics(labels) }), {
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'public, s-maxage=3600, stale-while-revalidate=86400',
      },
    })
  } catch (err) {
    log.error(errorFields(err), 'llms.txt failed')
    return new Response('temporarily unavailable', { status: 503 })
  }
}
