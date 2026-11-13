import { errorFields } from '@reelset/core'
import { cookies } from 'next/headers'
import { pickFeedTabs } from '@/lib/feed-tabs'
import { groupTopics } from '@/lib/seo/feeds'
import { getOptionalUser } from '@/server/auth'
import { getDb } from '@/server/db'
import { routeLog } from '@/server/logger'
import { listTopicLabels } from '@/server/seo-queries'

export const dynamic = 'force-dynamic'

export async function GET() {
  const log = routeLog('api/feed/tabs')
  try {
    await cookies()
    const db = getDb()
    const user = await getOptionalUser()
    const [labels, profile] = await Promise.all([
      listTopicLabels(db),
      user
        ? db.selectFrom('profile').select('topics').where('id', '=', user.id).executeTakeFirst()
        : Promise.resolve(undefined),
    ])
    const following = profile?.topics ?? []
    const tabs = pickFeedTabs({ followed: following, groups: groupTopics(labels) })
    return Response.json({ tabs, following }, { headers: { 'cache-control': 'no-store' } })
  } catch (err) {
    log.error(errorFields(err), 'feed tabs failed')
    return Response.json({ error: 'internal' }, { status: 500 })
  }
}
