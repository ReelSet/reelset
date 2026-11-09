import { errorFields } from '@reelset/core'
import { topicsBodySchema } from '@/lib/topics'
import { authErrorResponse, requireUser } from '@/server/auth'
import { getDb } from '@/server/db'
import { routeLog } from '@/server/logger'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const log = routeLog('api/profile/topics')
  const body = topicsBodySchema.safeParse(await request.json().catch(() => null))
  if (!body.success) return Response.json({ error: 'invalid_body' }, { status: 400 })

  try {
    const user = await requireUser('/')
    const topics = [...new Set(body.data.topics)]
    await getDb()
      .updateTable('profile')
      .set({ topics, updated_at: new Date() })
      .where('id', '=', user.id)
      .execute()
    log.info({ profileId: user.id, count: topics.length }, 'topics saved')
    return Response.json({ topics })
  } catch (err) {
    const authResponse = authErrorResponse(err)
    if (authResponse) return authResponse
    log.error(errorFields(err), 'topics route failed')
    return Response.json({ error: 'internal' }, { status: 500 })
  }
}
