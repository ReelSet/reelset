import { ItemStatus, errorFields, type Database, type Logger } from '@reelset/core'
import { sql } from 'kysely'
import { FALLBACK_SUGGESTIONS, buildSuggestions } from '@/lib/ask/suggestions'

const TTL_MS = 10 * 60_000
const WINDOW_DAYS = 7
let cache: { at: number; value: string[] } | null = null

export async function loadAskSuggestions(db: Database, log?: Logger): Promise<string[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value
  try {
    const [topics, titles] = await Promise.all([
      sql<{ label: string; count: number }>`
        select t as label, count(*)::int as count
        from item i, unnest(i.topics) t
        where i.status = ${ItemStatus.rendered}::item_status
          and coalesce(i.rendered_at, i.published_at) > now() - make_interval(days => ${WINDOW_DAYS})
        group by t
        order by count(*) desc
        limit 6`.execute(db),
      sql<{ title: string }>`
        select i.title
        from item i
        where i.status = ${ItemStatus.rendered}::item_status
        order by coalesce(i.rendered_at, i.published_at) desc, i.id desc
        limit 12`.execute(db),
    ])
    const value = buildSuggestions(
      topics.rows,
      titles.rows.map((r) => r.title),
    )
    cache = { at: Date.now(), value }
    return value
  } catch (err) {
    log?.error(errorFields(err), 'ask suggestions failed')
    return FALLBACK_SUGGESTIONS
  }
}
