import { errorFields } from '@reelset/core'
import { buildLlmsFullTxt } from '@/lib/seo/feeds'
import { getDb } from '@/server/db'
import { mediaBaseUrl } from '@/server/env'
import { routeLog } from '@/server/logger'
import { listReelTranscripts } from '@/server/seo-queries'

export const dynamic = 'force-dynamic'

const LLMS_FULL_REELS = 200

export async function GET() {
  const log = routeLog('llms-full.txt')
  try {
    const reels = await listReelTranscripts(getDb(), mediaBaseUrl(), LLMS_FULL_REELS)
    return new Response(buildLlmsFullTxt(reels), {
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'public, s-maxage=3600, stale-while-revalidate=86400',
      },
    })
  } catch (err) {
    log.error(errorFields(err), 'llms-full.txt failed')
    return new Response('temporarily unavailable', { status: 503 })
  }
}
