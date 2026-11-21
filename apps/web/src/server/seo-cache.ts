import { unstable_cache } from 'next/cache'
import type { FeedItemDto, FeedResponse } from '@/lib/api-types'
import { FEED_TAG, reelTag } from '@/lib/cache-tags'
import type { ReelParam } from '@/lib/reel-url'
import { loadCountRules } from '@/server/counts'
import { getDb } from '@/server/db'
import { mediaBaseUrl } from '@/server/env'
import { loadFeedItemDto, loadFeedResponse } from '@/server/feed'
import { routeLog } from '@/server/logger'
import {
  countRenderedReels,
  labelsForSlug,
  listReelSummaries,
  listSourceCounts,
  listTopicLabels,
  loadOgFields,
  loadReelPage,
} from '@/server/seo-queries'

// Matches the ISR period of the /t pages and the home page: unstable_cache lowers a page's
// revalidate to its own, so a shorter value here would regenerate those pages more often.
const SEO_REVALIDATE_SECONDS = 300

const options = { revalidate: SEO_REVALIDATE_SECONDS }

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

/** Anonymous first feed page, shared by every visitor and crawler. */
export function cachedAnonFeed(revalidate: number): Promise<FeedResponse> {
  return unstable_cache(
    () =>
      loadFeedResponse(getDb(), {
        profileId: null,
        authenticated: false,
        base: mediaBaseUrl(),
        log: routeLog('anon-feed'),
      }),
    ['anon-feed', String(revalidate)],
    { revalidate, tags: [FEED_TAG] },
  )()
}

/** Anonymous feed card of the reel a /r/ page opens on. */
export function cachedFocusItem(itemId: string, revalidate: number): Promise<FeedItemDto | null> {
  return unstable_cache(
    () =>
      loadFeedItemDto(getDb(), {
        itemId,
        profileId: null,
        base: mediaBaseUrl(),
        log: routeLog('focus-item'),
      }),
    ['focus-item', itemId, String(revalidate)],
    { revalidate, tags: [reelTag(itemId)] },
  )()
}

/** The /r/ page data, tagged so a takedown drops the cached page at once. */
export function cachedReelPage(param: ReelParam, revalidate: number) {
  return unstable_cache(
    () => loadReelPage(getDb(), param, mediaBaseUrl(), routeLog('r/[slug]')),
    ['reel-page', param.shortId, param.slug, param.id ?? '', String(revalidate)],
    { revalidate, tags: [reelTag(param.shortId)] },
  )()
}

/** Topic labels for a /t/ or ?topic= slug, from the shared label list. */
export async function cachedTopicLabelsFor(slug: string): Promise<string[]> {
  return labelsForSlug(await cachedTopicLabels(null), slug)
}

/** OG card fields of one reel, tagged like its page. */
export function cachedOgFields(param: ReelParam, revalidate: number) {
  return unstable_cache(
    () => loadOgFields(getDb(), param, mediaBaseUrl()),
    ['og-fields', param.shortId, param.slug, param.id ?? '', String(revalidate)],
    { revalidate, tags: [reelTag(param.shortId)] },
  )()
}
