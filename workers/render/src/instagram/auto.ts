import {
  SETTINGS,
  autoPostsQueuedToday,
  buildCaption,
  getSetting,
  insertAutoPost,
  listAutoPostCandidates,
  parseCaptionCredits,
  type Database,
  type Logger,
} from '@reelset/core'

export type AutoCandidate = Awaited<ReturnType<typeof listAutoPostCandidates>>[number]

export type AutoPostDeps = {
  enabled(): Promise<boolean>
  dailyLimit(): Promise<number>
  queuedToday(): Promise<number>
  candidates(limit: number): Promise<AutoCandidate[]>
  insert(post: { itemId: string; videoKey: string; caption: string }): Promise<boolean>
}

export function createAutoPostDeps(db: Database, log: Logger): AutoPostDeps {
  return {
    enabled: () => getSetting(db, SETTINGS.instagramAutoPost, log),
    dailyLimit: () => getSetting(db, SETTINGS.dailyReelCap, log),
    queuedToday: () => autoPostsQueuedToday(db),
    candidates: (limit) => listAutoPostCandidates(db, limit),
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
  const [limit, queuedToday] = await Promise.all([deps.dailyLimit(), deps.queuedToday()])
  const remaining = limit - queuedToday
  if (remaining <= 0) {
    l.debug({ limit, queuedToday }, 'daily auto post limit reached')
    return 0
  }
  const candidates = await deps.candidates(remaining)
  let queued = 0
  for (const c of candidates) {
    const caption = buildCaption({
      title: c.title,
      hook: c.hook,
      tldr: c.tldr,
      canonicalUrl: c.canonical_url,
      topics: c.topics,
      credits: parseCaptionCredits(c.credits),
    })
    const inserted = await deps.insert({ itemId: c.id, videoKey: c.video_key, caption })
    if (inserted) queued++
    l.info(
      { itemId: c.id, inserted },
      inserted ? 'reel auto-queued for instagram' : 'already queued',
    )
  }
  if (candidates.length) l.info({ queued, limit, queuedToday }, 'instagram auto post done')
  return queued
}
