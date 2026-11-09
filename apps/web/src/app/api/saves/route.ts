import { errorFields } from '@reelset/core'
import { reelPath } from '@/lib/auth/return-url'
import { saveBodySchema } from '@/lib/saves'
import { authErrorResponse, requireUser } from '@/server/auth'
import { getDb } from '@/server/db'
import { routeLog } from '@/server/logger'
import { setSave } from '@/server/saves'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const log = routeLog('api/saves')
  const body = saveBodySchema.safeParse(await request.json().catch(() => null))
  if (!body.success) return Response.json({ error: 'invalid_body' }, { status: 400 })

  try {
    const user = await requireUser(reelPath(body.data.itemId))
    const result = await setSave(
      getDb(),
      { profileId: user.id, itemId: body.data.itemId, saved: body.data.saved },
      log,
    )
    if (result.status === 'not_found') return Response.json({ error: 'not_found' }, { status: 404 })
    return Response.json(result)
  } catch (err) {
    const authResponse = authErrorResponse(err)
    if (authResponse) return authResponse
    log.error(errorFields(err), 'saves route failed')
    return Response.json({ error: 'internal' }, { status: 500 })
  }
}
