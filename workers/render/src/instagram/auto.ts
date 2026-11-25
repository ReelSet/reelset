import {
  SETTINGS,
  autoPostsQueuedToday,
  buildCaption,
  getSetting,
  insertAutoPost,
  listAutoPostCandidates,
  listRecentPostTitles,
  parseCaptionCredits,
  sameStory,
  type Database,
  type Logger,
} from '@reelset/core'

// How far back a posted or queued reel makes a later one on the same story a duplicate.
export const DUPLICATE_LOOKBACK_HOURS = 72

export type AutoCandidate = Awaited<ReturnType<typeof listAutoPostCandidates>>[number]

export type AutoPostDeps = {
  enabled(): Promise<boolean>
  requireGatePass(): Promise<boolean>
  dailyLimit(): Promise<number>
  queuedToday(): Promise<number>
  candidates(limit: number, opts: { requireGatePass: boolean }): Promise<AutoCandidate[]>
  recentPosts(hours: number): Promise<{ item_id: string; title: string }[]>
  insert(post: { itemId: string; videoKey: string; caption: string }): Promise<boolean>
}

export function createAutoPostDeps(db: Database, log: Logger): AutoPostDeps {
  return {
    enabled: () => getSetting(db, SETTINGS.instagramAutoPost, log),
    requireGatePass: () => getSetting(db, SETTINGS.instagramAutoPostGate, log),
    dailyLimit: () => getSetting(db, SETTINGS.dailyReelCap, log),
    queuedToday: () => autoPostsQueuedToday(db),
    candidates: (limit, opts) => listAutoPostCandidates(db, limit, opts),
    recentPosts: (hours) => listRecentPostTitles(db, hours),
    insert: (post) => insertAutoPost(db, post),
  }
}

/** Queues newly rendered reels for Instagram, at most the daily reel cap per UTC day. */
export async function queueAutoInstagramPosts(deps: AutoPostDeps, log: Logger): Promise<number> {
  const l = log.child({ fn: 'queueAutoInstagramPosts' })
  if (!(await deps.enabled())) {
    l.debug('instagram auto post is off')
    return 0
  }
  const [limit, queuedToday, requireGatePass] = await Promise.all([
    deps.dailyLimit(),
    deps.queuedToday(),
    deps.requireGatePass(),
  ])
  const remaining = limit - queuedToday
  if (remaining <= 0) {
    l.debug({ limit, queuedToday }, 'daily auto post limit reached')
    return 0
  }
  const candidates = await deps.candidates(remaining, { requireGatePass })
  l.debug({ requireGatePass, candidates: candidates.length }, 'auto post candidates')
  const recent = candidates.length ? [...(await deps.recentPosts(DUPLICATE_LOOKBACK_HOURS))] : []
  let queued = 0
  for (const c of candidates) {
    const twin = recent.find((p) => sameStory(p.title, c.title))
    if (twin) {
      l.debug({ itemId: c.id, duplicateOf: twin.item_id }, 'duplicate story, not queued')
      continue
    }
    const caption = buildCaption({
      title: c.title,
      hook: c.hook,
      tldr: c.tldr,
      canonicalUrl: c.canonical_url,
      topics: c.topics,
      credits: parseCaptionCredits(c.credits),
    })
    const inserted = await deps.insert({ itemId: c.id, videoKey: c.video_key, caption })
    if (inserted) {
      queued++
      recent.push({ item_id: c.id, title: c.title })
    }
    l.info(
      { itemId: c.id, inserted },
      inserted ? 'reel auto-queued for instagram' : 'already queued',
    )
  }
  if (candidates.length)
    l.info({ queued, limit, queuedToday, requireGatePass }, 'instagram auto post done')
  return queued
}
