import { errorFields } from '@reelset/core'
import { cookies } from 'next/headers'
import { FeedClient } from '@/components/feed/FeedClient'
import { JsonLd } from '@/components/seo/PageChrome'
import type { FeedResponse } from '@/lib/api-types'
import { siteJsonLd } from '@/lib/seo/json-ld'
import { SITE_NAME, SITE_TAGLINE } from '@/lib/seo/site'
import { getOptionalUser } from '@/server/auth'
import { getDb } from '@/server/db'
import { mediaBaseUrl } from '@/server/env'
import { loadFeedResponse } from '@/server/feed'
import { routeLog } from '@/server/logger'

export const dynamic = 'force-dynamic'

// Old `/?reel=<uuid>` share links are redirected in proxy.ts before this renders.
export default async function FeedPage() {
  const log = routeLog('feed-page')
  let initial: FeedResponse | undefined
  try {
    await cookies()
    const user = await getOptionalUser()
    initial = await loadFeedResponse(getDb(), {
      profileId: user?.id ?? null,
      authenticated: user !== null,
      base: mediaBaseUrl(),
      log,
    })
  } catch (err) {
    log.error(errorFields(err), 'server feed failed, client will load it')
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
