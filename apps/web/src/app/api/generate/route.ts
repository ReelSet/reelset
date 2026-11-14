import { getDb } from '@/server/db'
import { createGenerateRequest, getCredits, listMyRequests } from '@/server/generate/service'
import { apiError, internalError, viewerOrResponse } from '@/server/generate/http'
import { routeLog } from '@/server/logger'
import type { GenerateListResponse, GenerateResponse } from '@/lib/generate/types'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const log = routeLog('api/generate')
  const viewer = await viewerOrResponse('/create', log)
  if (viewer instanceof Response) return viewer
  const body = (await request.json().catch(() => null)) as { urls?: unknown } | null
  if (!body || !Array.isArray(body.urls)) {
    return apiError('invalid_urls', 'Send {"urls": ["https://..."]}.', 400)
  }
  try {
    const result = await createGenerateRequest(
      getDb(),
      { user: viewer, urls: body.urls, via: 'web' },
      log.child({ userId: viewer.id }),
    )
    if (!result.ok) return apiError(result.error, result.message, result.status)
    return Response.json(
      { request: result.request, credits: result.credits } satisfies GenerateResponse,
      {
        status: 201,
      },
    )
  } catch (err) {
    return internalError(log, err)
  }
}

export async function GET() {
  const log = routeLog('api/generate')
  const viewer = await viewerOrResponse('/create', log)
  if (viewer instanceof Response) return viewer
  try {
    const db = getDb()
    const [requests, credits] = await Promise.all([
      listMyRequests(db, viewer.id, 20, log),
      getCredits(db, viewer, log),
    ])
    return Response.json({ requests, credits } satisfies GenerateListResponse)
  } catch (err) {
    return internalError(log, err)
  }
}
