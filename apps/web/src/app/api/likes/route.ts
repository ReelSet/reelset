import { errorFields } from '@reelset/core'
import { after } from 'next/server'
import { reelReturnPath } from '@/lib/auth/return-url'
import { likeBodySchema } from '@/lib/likes'
import { authErrorResponse, requireUser } from '@/server/auth'
import { getDb } from '@/server/db'
import { setLike } from '@/server/likes'
import { routeLog } from '@/server/logger'
import { scheduleTasteRecompute } from '@/server/taste'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const log = routeLog('api/likes')
  const body = likeBodySchema.safeParse(await request.json().catch(() => null))
  if (!body.success) return Response.json({ error: 'invalid_body' }, { status: 400 })

  try {
    const user = await requireUser(reelReturnPath(body.data.itemId))
    const result = await setLike(
      getDb(),
      { profileId: user.id, itemId: body.data.itemId, liked: body.data.liked },
      log,
    )
    if (result.status === 'not_found') return Response.json({ error: 'not_found' }, { status: 404 })
    if (result.changed) after(() => scheduleTasteRecompute(getDb(), user.id, log))
    return Response.json(result)
  } catch (err) {
    const authResponse = authErrorResponse(err)
    if (authResponse) {
      log.info({ itemId: body.data.itemId }, 'like rejected: logged out')
      return authResponse
    }
    log.error(errorFields(err), 'likes route failed')
    return Response.json({ error: 'internal' }, { status: 500 })
  }
}
