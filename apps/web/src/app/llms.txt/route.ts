import { errorFields } from '@reelset/core'
import { routeLog } from '@/server/logger'
import { loadSiteMarkdown } from '@/server/site-markdown'

export const revalidate = 3600

export async function GET() {
  const log = routeLog('llms.txt')
  try {
    return new Response(await loadSiteMarkdown(), {
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
