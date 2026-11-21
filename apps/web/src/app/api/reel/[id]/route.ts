import { errorFields } from '@reelset/core'
import { parseReelParam } from '@/lib/reel-url'
import { getDb } from '@/server/db'
import { mediaBaseUrl } from '@/server/env'
import { routeLog } from '@/server/logger'
import { loadReelPage } from '@/server/seo-queries'

export const dynamic = 'force-dynamic'

// Browsers keep it 5 min; the edge keeps it as long as the reel page's ISR period, so a takedown
// is gone from every cache within the hour (edge Cache API entries cannot be purged globally).
const REEL_CACHE_CONTROL = 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400'

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const log = routeLog('api/reel')
  const param = parseReelParam((await ctx.params).id)
  if (!param?.id) return Response.json({ error: 'invalid_id' }, { status: 400 })
  try {
    const reel = await loadReelPage(getDb(), param, mediaBaseUrl(), log)
    if (!reel) return Response.json({ error: 'not_found' }, { status: 404 })
    const cacheControl = reel.visibility === 'private' ? 'private, no-store' : REEL_CACHE_CONTROL
    return Response.json(reel, { headers: { 'cache-control': cacheControl } })
  } catch (err) {
    log.error(errorFields(err), 'reel details failed')
    return Response.json({ error: 'internal' }, { status: 500 })
  }
}
