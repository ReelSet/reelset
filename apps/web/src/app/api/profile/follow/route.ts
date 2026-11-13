import { errorFields } from '@reelset/core'
import { followBodySchema } from '@/lib/topics'
import { authErrorResponse, requireUser } from '@/server/auth'
import { getDb } from '@/server/db'
import { routeLog } from '@/server/logger'
import { setTopicFollow } from '@/server/preferences'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const log = routeLog('api/profile/follow')
  const body = followBodySchema.safeParse(await request.json().catch(() => null))
  if (!body.success) return Response.json({ error: 'invalid_body' }, { status: 400 })
  try {
    const user = await requireUser('/')
    const result = await setTopicFollow(getDb(), { profileId: user.id, ...body.data }, log)
    if (result.status === 'full')
      return Response.json({ error: 'full', topics: result.topics }, { status: 409 })
    return Response.json({ topics: result.topics })
  } catch (err) {
    const authResponse = authErrorResponse(err)
    if (authResponse) return authResponse
    log.error(errorFields(err), 'follow route failed')
    return Response.json({ error: 'internal' }, { status: 500 })
  }
}
