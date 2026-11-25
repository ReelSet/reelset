import { buildLlmsTxt, groupTopics } from '@/lib/seo/feeds'
import { getDb } from '@/server/db'
import { mediaBaseUrl } from '@/server/env'
import { listReelSummaries, listTopicLabels } from '@/server/seo-queries'

const LLMS_REELS = 100

/** The site overview as markdown: served as /llms.txt, /index.md and to Accept: text/markdown. */
export async function loadSiteMarkdown(): Promise<string> {
  const db = getDb()
  const [reels, labels] = await Promise.all([
    listReelSummaries(db, mediaBaseUrl(), { limit: LLMS_REELS, withLeadSource: false }),
    listTopicLabels(db),
  ])
  return buildLlmsTxt({ reels, topics: groupTopics(labels) })
}
