import { errorFields } from '@reelset/core'
import { authErrorResponse, requireUser } from '@/server/auth'
import { getDb } from '@/server/db'
import { routeLog } from '@/server/logger'
import { saveDetails } from '@/server/profile-edit'
import { getViewer } from '@/server/viewer'

export const dynamic = 'force-dynamic'

export async function GET() {
  const log = routeLog('api/profile')
  try {
    await requireUser('/profile')
    const viewer = await getViewer()
    if (!viewer) return Response.json({ error: 'unauthorized' }, { status: 401 })
    const { avatarUrl, initial, name } = viewer.identity
    return Response.json({ avatarUrl, initial, name })
  } catch (err) {
    const authResponse = authErrorResponse(err)
    if (authResponse) return authResponse
    log.error(errorFields(err), 'profile read failed')
    return Response.json({ error: 'internal' }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  const log = routeLog('api/profile')
  const raw = await request.json().catch(() => null)
  try {
    const user = await requireUser('/profile')
    const result = await saveDetails(getDb(), user.id, raw, log)
    if (!result.ok) {
      const status = result.error === 'rate_limited' ? 429 : 400
      return Response.json({ error: result.error }, { status })
    }
    return Response.json(result.value)
  } catch (err) {
    const authResponse = authErrorResponse(err)
    if (authResponse) return authResponse
    log.error(errorFields(err), 'profile route failed')
    return Response.json({ error: 'internal' }, { status: 500 })
  }
}
