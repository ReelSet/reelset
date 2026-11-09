import { errorFields } from '@reelset/core'
import { authErrorResponse, requireUser } from '@/server/auth'
import { getDb } from '@/server/db'
import { routeLog } from '@/server/logger'
import { saveTopics } from '@/server/preferences'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const log = routeLog('api/profile/topics')
  const raw = await request.json().catch(() => null)
  try {
    const user = await requireUser('/')
    const result = await saveTopics(getDb(), user.id, raw, log)
    if (!result.ok) return Response.json({ error: 'invalid_body' }, { status: 400 })
    return Response.json({ topics: result.value })
  } catch (err) {
    const authResponse = authErrorResponse(err)
    if (authResponse) return authResponse
    log.error(errorFields(err), 'topics route failed')
    return Response.json({ error: 'internal' }, { status: 500 })
  }
}
