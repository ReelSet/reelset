import { getDb } from '@/server/db'
import { getCredits } from '@/server/generate/service'
import { internalError, viewerOrResponse } from '@/server/generate/http'
import { routeLog } from '@/server/logger'

export const dynamic = 'force-dynamic'

export async function GET() {
  const log = routeLog('api/credits')
  const viewer = await viewerOrResponse('/profile', log)
  if (viewer instanceof Response) return viewer
  try {
    return Response.json(await getCredits(getDb(), viewer, log))
  } catch (err) {
    return internalError(log, err)
  }
}
