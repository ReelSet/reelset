import { revokeApiKey } from '@reelset/core'
import { z } from 'zod'
import { getDb } from '@/server/db'
import { apiError, internalError, viewerOrResponse } from '@/server/generate/http'
import { routeLog } from '@/server/logger'

export const dynamic = 'force-dynamic'

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const log = routeLog('api/keys/id')
  const viewer = await viewerOrResponse('/profile', log)
  if (viewer instanceof Response) return viewer
  if (!z.guid().safeParse(id).success) return apiError('not_found', 'Key not found.', 404)
  try {
    const revoked = await revokeApiKey(getDb(), { id, userId: viewer.id }, log)
    if (!revoked) return apiError('not_found', 'Key not found.', 404)
    return Response.json({ ok: true })
  } catch (err) {
    return internalError(log, err)
  }
}
