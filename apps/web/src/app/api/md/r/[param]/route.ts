import { errorFields } from '@reelset/core'
import { markdownResponse } from '@/lib/markdown-negotiation'
import { parseReelParam } from '@/lib/reel-url'
import { reelMarkdown } from '@/lib/seo/reel-markdown'
import { absoluteUrl } from '@/lib/seo/site'
import { routeLog } from '@/server/logger'
import { cachedReelPage } from '@/server/seo-cache'

export const dynamic = 'force-dynamic'

const REVALIDATE_SECONDS = 3600

const NOT_FOUND = `# Not found\n\nNo reel at this address. Latest reels: ${absoluteUrl('/llms.txt')}\n`

export async function GET(_req: Request, { params }: { params: Promise<{ param: string }> }) {
  const { param: raw } = await params
  const log = routeLog('api/md/r')
  const parsed = parseReelParam(raw)
  if (!parsed) {
    log.info('reel markdown not found: unparseable address')
    return markdownResponse(NOT_FOUND, { status: 404, noindex: true })
  }
  const l = log.child({ shortId: parsed.shortId })
  try {
    const reel = await cachedReelPage(parsed, REVALIDATE_SECONDS)
    if (!reel) {
      l.info('reel markdown not found')
      return markdownResponse(NOT_FOUND, { status: 404, noindex: true })
    }
    return markdownResponse(reelMarkdown(reel), { noindex: reel.visibility === 'private' })
  } catch (err) {
    l.error(errorFields(err), 'reel markdown failed')
    return markdownResponse('# Temporarily unavailable\n', { status: 503, noindex: true })
  }
}
