import { getDb } from '@/server/db'
import { requestMoreCredits } from '@/server/generate/upgrade'
import { apiError, internalError, viewerOrResponse } from '@/server/generate/http'
import { routeLog } from '@/server/logger'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const log = routeLog('api/credits/request')
  const viewer = await viewerOrResponse('/profile', log)
  if (viewer instanceof Response) return viewer
  const body = (await request.json().catch(() => null)) as { message?: unknown } | null
  try {
    const result = await requestMoreCredits(getDb(), { user: viewer, message: body?.message }, log)
    if (!result.ok) return apiError(result.error, result.message, result.status)
    return Response.json({ id: result.id }, { status: 201 })
  } catch (err) {
    return internalError(log, err)
  }
}
