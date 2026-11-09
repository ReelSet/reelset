import { errorFields } from '@reelset/core'
import { deleteBodySchema, historyQuerySchema } from '@/lib/ask/history'
import { deleteConversation, listHistory } from '@/server/ask-history'
import { authErrorResponse, requireUser } from '@/server/auth'
import { getDb } from '@/server/db'
import { routeLog } from '@/server/logger'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const log = routeLog('api/ask/history')
  const query = historyQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams))
  if (!query.success) return Response.json({ error: 'invalid_query' }, { status: 400 })
  try {
    const user = await requireUser('/ask/history')
    const page = await listHistory(getDb(), user.id, query.data.cursor ?? null, log)
    return Response.json(page, { headers: { 'cache-control': 'no-store' } })
  } catch (err) {
    const authResponse = authErrorResponse(err)
    if (authResponse) return authResponse
    log.error(errorFields(err), 'history list failed')
    return Response.json({ error: 'internal' }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  const log = routeLog('api/ask/history')
  const body = deleteBodySchema.safeParse(await request.json().catch(() => null))
  if (!body.success) return Response.json({ error: 'invalid_body' }, { status: 400 })
  try {
    const user = await requireUser('/ask/history')
    const count = await deleteConversation(getDb(), user.id, body.data.id, log)
    if (count === 0) return Response.json({ error: 'not_found' }, { status: 404 })
    return Response.json({ deleted: count })
  } catch (err) {
    const authResponse = authErrorResponse(err)
    if (authResponse) return authResponse
    log.error(errorFields(err), 'history delete failed')
    return Response.json({ error: 'internal' }, { status: 500 })
  }
}
