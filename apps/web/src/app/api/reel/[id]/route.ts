import { errorFields } from '@reelset/core'
import { parseReelParam } from '@/lib/reel-url'
import { getDb } from '@/server/db'
import { mediaBaseUrl } from '@/server/env'
import { routeLog } from '@/server/logger'
import { loadReelPage } from '@/server/seo-queries'

export const dynamic = 'force-dynamic'

const PUBLIC_CACHE_CONTROL = 'public, max-age=60, s-maxage=60, stale-while-revalidate=120'

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const log = routeLog('api/reel')
  const param = parseReelParam((await ctx.params).id)
  if (!param?.id) return Response.json({ error: 'invalid_id' }, { status: 400 })
  try {
    const reel = await loadReelPage(getDb(), param, mediaBaseUrl(), log)
    if (!reel) return Response.json({ error: 'not_found' }, { status: 404 })
    const cacheControl = reel.visibility === 'private' ? 'private, no-store' : PUBLIC_CACHE_CONTROL
    return Response.json(reel, { headers: { 'cache-control': cacheControl } })
  } catch (err) {
    log.error(errorFields(err), 'reel details failed')
    return Response.json({ error: 'internal' }, { status: 500 })
  }
}
