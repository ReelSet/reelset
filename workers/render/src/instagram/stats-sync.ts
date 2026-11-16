import { errorFields, permalinkShortcode, type PostForStats } from '@reelset/core'
import { OfficialApiError, type MediaStats } from './official-client'
import { loadOfficialToken } from './official-service'
import type { IgDeps } from './service'

export const STATS_SYNC_EVERY_MS = 60 * 60_000
// 500 media: far more than the account posts in the 60 days the gate looks at.
export const STATS_MAX_PAGES = 10
export const INSIGHTS_WINDOW_MS = 30 * 86_400_000
export const INSIGHTS_PER_RUN = 25
const INSIGHTS_MAX_FAILURES = 3
export const INSIGHTS_SCOPE = 'instagram_manage_insights'

export type StatsSyncOutcome =
  | { ran: false; reason: 'not_due' | 'no_token' | 'not_connected' }
  | {
      ran: true
      posts: number
      matched: number
      insights: number
      insightsPermission: boolean | null
    }

/**
 * Finds a post's media in the account list. Official posts store the Graph media id. Posts from the
 * unofficial publisher store an instagrapi pk instead, so they match by the shortcode in their
 * permalink, which is the same in both APIs.
 */
export function matchMedia(
  post: PostForStats,
  byId: Map<string, MediaStats>,
  byShortcode: Map<string, MediaStats>,
): MediaStats | null {
  const direct = post.media_pk ? byId.get(post.media_pk) : undefined
  if (direct) return direct
  const shortcode = permalinkShortcode(post.permalink)
  return (shortcode ? byShortcode.get(shortcode) : undefined) ?? null
}

async function rememberInsightsPermission(deps: IgDeps, allowed: boolean): Promise<void> {
  const account = await deps.store.getOfficialAccount()
  if (!account || account.insightsPermission === allowed) return
  await deps.store.setOfficialAccount({ ...account, insightsPermission: allowed })
}

/**
 * Hourly: likes and comments for every live post from the account's media list, then views, reach,
 * saves and shares for recent posts when the token may read insights. Runs for any saved official
 * token, whichever publisher is selected, and never touches the post queue.
 */
export async function syncInstagramStats(deps: IgDeps): Promise<StatsSyncOutcome> {
  const log = deps.log.child({ op: 'ig-stats-sync' })
  const now = deps.now?.() ?? new Date()
  const last = await deps.store.getStatsSyncedAt()
  if (last && now.getTime() - last.getTime() < STATS_SYNC_EVERY_MS)
    return { ran: false, reason: 'not_due' }
  const token = await loadOfficialToken(deps)
  if (!token) return { ran: false, reason: 'no_token' }
  const account = await deps.store.getOfficialAccount()
  if (account?.state === 'needs_login' || account?.state === 'disconnected')
    return { ran: false, reason: 'not_connected' }
  // Stamped first: a failing sync waits for the next hour instead of retrying every cron tick.
  await deps.store.setStatsSyncedAt(now)

  const posts = await deps.store.listPostsForStats()
  if (posts.length === 0) {
    log.debug('no live instagram posts to sync')
    return { ran: true, posts: 0, matched: 0, insights: 0, insightsPermission: null }
  }

  const byId = new Map<string, MediaStats>()
  const byShortcode = new Map<string, MediaStats>()
  let after: string | null = null
  let pages = 0
  do {
    const page = await deps.official.listMediaStats(token.accessToken, token.userId, after)
    pages += 1
    for (const media of page.media) {
      byId.set(media.id, media)
      const shortcode = media.shortcode ?? permalinkShortcode(media.permalink)
      if (shortcode) byShortcode.set(shortcode, media)
    }
    after = page.next
  } while (after && pages < STATS_MAX_PAGES)

  const matched: { post: PostForStats; media: MediaStats }[] = []
  for (const post of posts) {
    const media = matchMedia(post, byId, byShortcode)
    if (!media) {
      log.debug({ postId: post.id, official: post.official }, 'post not found in the media list')
      continue
    }
    await deps.store.setPostStats(post.id, { likes: media.likes, comments: media.comments })
    matched.push({ post, media })
  }
  log.info(
    { posts: posts.length, matched: matched.length, media: byId.size, pages },
    'instagram likes and comments synced',
  )

  if (token.scopes && !token.scopes.includes(INSIGHTS_SCOPE)) {
    await rememberInsightsPermission(deps, false)
    log.info('insights skipped: the token lacks instagram_manage_insights')
    return {
      ran: true,
      posts: posts.length,
      matched: matched.length,
      insights: 0,
      insightsPermission: false,
    }
  }

  const due = matched
    .filter(
      ({ post }) => post.posted_at && now.getTime() - post.posted_at.getTime() < INSIGHTS_WINDOW_MS,
    )
    .sort((a, b) => (a.post.insights_at?.getTime() ?? 0) - (b.post.insights_at?.getTime() ?? 0))
    .slice(0, INSIGHTS_PER_RUN)
  let insights = 0
  let failures = 0
  let permission: boolean | null = null
  for (const { post, media } of due) {
    try {
      await deps.store.setPostInsights(
        post.id,
        await deps.official.getMediaInsights(token.accessToken, media.id),
      )
      insights += 1
      permission = true
    } catch (err) {
      const kind = err instanceof OfficialApiError ? err.kind : null
      if (kind === 'permission') {
        permission = false
        log.info({ postId: post.id }, 'insights skipped: the token may not read insights')
        break
      }
      log.warn({ postId: post.id, mediaId: media.id, ...errorFields(err) }, 'insights read failed')
      // Instagram has no insights for this media (for example it predates the business account).
      if (kind === 'rejected') await deps.store.setPostInsights(post.id, null)
      failures += 1
      if (kind === 'rate_limited' || kind === 'token_invalid' || failures >= INSIGHTS_MAX_FAILURES)
        break
    }
  }
  if (permission !== null) await rememberInsightsPermission(deps, permission)
  log.info({ due: due.length, insights, failures, permission }, 'instagram insights synced')
  return {
    ran: true,
    posts: posts.length,
    matched: matched.length,
    insights,
    insightsPermission: permission,
  }
}
