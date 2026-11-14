import { getDb } from '@/server/db'
import { getRequestForViewer } from '@/server/generate/service'
import { apiError, internalError, viewerOrResponse } from '@/server/generate/http'
import { routeLog } from '@/server/logger'

export const dynamic = 'force-dynamic'

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const log = routeLog('api/generate/id')
  const viewer = await viewerOrResponse(`/create/${encodeURIComponent(id)}`, log)
  if (viewer instanceof Response) return viewer
  try {
    const request = await getRequestForViewer(getDb(), id, viewer, log.child({ requestId: id }))
    if (!request) return apiError('not_found', 'Request not found.', 404)
    return Response.json({ request })
  } catch (err) {
    return internalError(log, err)
  }
}
