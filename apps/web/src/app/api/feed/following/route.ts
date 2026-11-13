import { errorFields } from '@reelset/core'
import { cookies } from 'next/headers'
import { getOptionalUser } from '@/server/auth'
import { getDb } from '@/server/db'
import { routeLog } from '@/server/logger'

export const dynamic = 'force-dynamic'

export async function GET() {
  const log = routeLog('api/feed/following')
  try {
    await cookies()
    const user = await getOptionalUser()
    const profile = user
      ? await getDb()
          .selectFrom('profile')
          .select('topics')
          .where('id', '=', user.id)
          .executeTakeFirst()
      : undefined
    return Response.json(
      { following: profile?.topics ?? [] },
      { headers: { 'cache-control': 'no-store' } },
    )
  } catch (err) {
    log.error(errorFields(err), 'feed following failed')
    return Response.json({ error: 'internal' }, { status: 500 })
  }
}
