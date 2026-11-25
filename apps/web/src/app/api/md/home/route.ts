import { errorFields } from '@reelset/core'
import { markdownResponse } from '@/lib/markdown-negotiation'
import { routeLog } from '@/server/logger'
import { loadSiteMarkdown } from '@/server/site-markdown'

export const revalidate = 3600

export async function GET() {
  const log = routeLog('api/md/home')
  try {
    return markdownResponse(await loadSiteMarkdown())
  } catch (err) {
    log.error(errorFields(err), 'home markdown failed')
    return markdownResponse('# Temporarily unavailable\n', { status: 503, noindex: true })
  }
}
