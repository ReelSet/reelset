import { getDb } from '@/server/db'
import { apiError, internalError, viewerOrResponse } from '@/server/generate/http'
import { submitToFeed, withdrawFromFeed, type PublishResult } from '@/server/generate/publish'
import { routeLog } from '@/server/logger'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }
type Change = typeof submitToFeed

function respond(result: PublishResult): Response {
  if (!result.ok) return apiError(result.error, result.message, result.status)
  return Response.json({ request: result.request })
}

async function handle(ctx: Ctx, change: Change, action: string): Promise<Response> {
  const { id } = await ctx.params
  const log = routeLog(`api/generate/id/publish`).child({ action, requestId: id })
  const viewer = await viewerOrResponse(`/create/${encodeURIComponent(id)}`, log)
  if (viewer instanceof Response) return viewer
  try {
    return respond(await change(getDb(), { viewer, requestId: id }, log))
  } catch (err) {
    return internalError(log, err)
  }
}

// Submit a finished private reel for review before it appears in the public feed.
export async function POST(_request: Request, ctx: Ctx) {
  return handle(ctx, submitToFeed, 'submit')
}

// Cancel a pending review, or take a published reel back to private.
export async function DELETE(_request: Request, ctx: Ctx) {
  return handle(ctx, withdrawFromFeed, 'withdraw')
}
