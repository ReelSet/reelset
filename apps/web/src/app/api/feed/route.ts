import { errorFields } from '@reelset/core'
import { cookies } from 'next/headers'
import { getFeedItem } from '@/lib/ranking'
import { getOptionalUser } from '@/server/auth'
import { getDb } from '@/server/db'
import { mediaBaseUrl } from '@/server/env'
import { loadFeedResponse, toFeedDto } from '@/server/feed'
import { routeLog } from '@/server/logger'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const querySchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().optional(),
  item: z.guid().optional(),
})

export async function GET(request: Request) {
  const log = routeLog('api/feed')
  const params = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams))
  if (!params.success) return Response.json({ error: 'invalid_query' }, { status: 400 })

  try {
    await cookies()
    const db = getDb()
    const base = mediaBaseUrl()
    const user = await getOptionalUser()
    const profileId = user?.id ?? null

    if (params.data.item) {
      const item = await getFeedItem(db, { itemId: params.data.item, profileId, log })
      if (!item) return Response.json({ error: 'not_found' }, { status: 404 })
      return Response.json(
        { item: toFeedDto(item, base) },
        { headers: { 'cache-control': 'no-store' } },
      )
    }

    const body = await loadFeedResponse(db, {
      profileId,
      authenticated: user !== null,
      base,
      cursor: params.data.cursor ?? null,
      limit: params.data.limit,
      log,
    })
    return Response.json(body, { headers: { 'cache-control': 'no-store' } })
  } catch (err) {
    log.error(errorFields(err), 'feed request failed')
    return Response.json({ error: 'internal' }, { status: 500 })
  }
}
