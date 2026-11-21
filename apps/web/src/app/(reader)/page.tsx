import { errorFields } from '@reelset/core'
import type { Metadata } from 'next'
import { FeedClient } from '@/components/feed/FeedClient'
import { JsonLd } from '@/components/seo/PageChrome'
import type { FeedResponse } from '@/lib/api-types'
import { siteJsonLd } from '@/lib/seo/json-ld'
import { SITE_NAME, SITE_TAGLINE } from '@/lib/seo/site'
import { routeLog } from '@/server/logger'
import { cachedAnonFeed } from '@/server/seo-cache'

export const revalidate = 300

export const metadata: Metadata = { alternates: { canonical: '/' } }

// One anonymous shell for everyone: FeedClient re-fetches the personal or ?topic= feed in the
// browser. Old `/?reel=<uuid>` share links are redirected in proxy.ts before this renders.
export default async function FeedPage() {
  let initial: FeedResponse | undefined
  try {
    initial = await cachedAnonFeed(revalidate)
  } catch (err) {
    routeLog('feed-page').error(errorFields(err), 'server feed failed, client will load it')
  }

  return (
    <>
      <JsonLd data={siteJsonLd()} />
      <h1 className="sr-only">
        {SITE_NAME}: {SITE_TAGLINE}
      </h1>
      <FeedClient initial={initial} />
    </>
  )
}
