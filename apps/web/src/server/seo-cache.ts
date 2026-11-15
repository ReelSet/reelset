import { unstable_cache } from 'next/cache'
import { loadCountRules } from '@/server/counts'
import { getDb } from '@/server/db'
import { mediaBaseUrl } from '@/server/env'
import { routeLog } from '@/server/logger'
import {
  countRenderedReels,
  listReelSummaries,
  listSourceCounts,
  listTopicLabels,
} from '@/server/seo-queries'

const SEO_REVALIDATE_SECONDS = 60

const options = { revalidate: SEO_REVALIDATE_SECONDS }

// Filter clicks repeat these aggregate queries; a minute of staleness is invisible on browse pages.
export const cachedTopicLabels = unstable_cache(
  (source: string | null) => listTopicLabels(getDb(), source),
  ['seo-topic-labels'],
  options,
)

export const cachedSourceCounts = unstable_cache(
  (labels: string[] | null) => listSourceCounts(getDb(), labels ?? undefined),
  ['seo-source-counts'],
  options,
)

export const cachedReelSummaries = unstable_cache(
  (limit: number, labels: string[] | null, source: string | null) =>
    listReelSummaries(getDb(), mediaBaseUrl(), { limit, labels: labels ?? undefined, source }),
  ['seo-reel-summaries'],
  options,
)

export const cachedCountRules = unstable_cache(
  () => loadCountRules(getDb(), routeLog('seo-cache')),
  ['seo-count-rules'],
  options,
)

export const cachedTotalReels = unstable_cache(
  () => countRenderedReels(getDb()),
  ['seo-total-reels'],
  options,
)
