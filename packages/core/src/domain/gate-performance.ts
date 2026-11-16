export const GATE_PERFORMANCE_MIN_POSTS = 12
export const GATE_PERFORMANCE_TAIL_SHARE = 0.2
export const GATE_PERFORMANCE_MAX_PER_SIDE = 6
export const GATE_PERFORMANCE_EXAMPLES_MAX = GATE_PERFORMANCE_MAX_PER_SIDE * 2
export const DEFAULT_GATE_PERFORMANCE_EXAMPLES = 8
/** A post only counts as a clear winner or loser this far from the account's usual result. */
export const GATE_PERFORMANCE_WINNER_MIN_MULTIPLE = 1.5
export const GATE_PERFORMANCE_LOSER_MAX_MULTIPLE = 0.67
const VIEWS_COVERAGE_MIN = 0.8
const COMMENT_WEIGHT = 2

/** One posted reel with its Instagram numbers; `listInstagramPerformance` rows fit as they are. */
export type GatePerformancePost = {
  itemId: string
  title: string
  source: string
  likes: number | null
  comments: number | null
  views: number | null
}

export type GatePerformanceMetric = 'views' | 'interactions'

export type GatePerformanceExample = {
  itemId: string
  title: string
  source: string
  outcome: 'winner' | 'loser'
  /** The post's engagement as a multiple of the account median, to one decimal. */
  multiple: number
}

/** Views when at least 80% of the posts have them; otherwise likes plus twice the comments, since a comment takes more effort than a like. */
export function performanceMetric(posts: readonly GatePerformancePost[]): GatePerformanceMetric {
  const withViews = posts.filter((post) => post.views !== null).length
  return posts.length > 0 && withViews / posts.length >= VIEWS_COVERAGE_MIN
    ? 'views'
    : 'interactions'
}

function engagement(post: GatePerformancePost, metric: GatePerformanceMetric): number | null {
  if (metric === 'views') return post.views
  if (post.likes === null && post.comments === null) return null
  return (post.likes ?? 0) + COMMENT_WEIGHT * (post.comments ?? 0)
}

function median(sortedDescending: readonly number[]): number {
  const middle = Math.floor(sortedDescending.length / 2)
  return sortedDescending.length % 2 === 1
    ? sortedDescending[middle]!
    : (sortedDescending[middle - 1]! + sortedDescending[middle]!) / 2
}

/**
 * Picks the account's clear winners and losers to show the judge, each as a multiple of the median post.
 * Nothing is returned below 12 measured posts or when the median is zero. Only the top and bottom fifth
 * are considered (at most 6 a side, and half of `limit` each), and only posts at least 1.5x or at most
 * 0.67x the median; the noisy middle is never shown. Winners come first, best first; then losers, worst first.
 */
export function selectPerformanceExamples(
  posts: readonly GatePerformancePost[],
  opts: { limit: number; excludeItemIds?: ReadonlySet<string> },
): GatePerformanceExample[] {
  const limit = Math.min(Math.trunc(opts.limit), GATE_PERFORMANCE_EXAMPLES_MAX)
  if (!(limit > 0)) return []
  const metric = performanceMetric(posts)
  const measured = posts
    .flatMap((post) => {
      const value = engagement(post, metric)
      return value === null || !Number.isFinite(value) ? [] : [{ post, value }]
    })
    .sort((a, b) => b.value - a.value)
  if (measured.length < GATE_PERFORMANCE_MIN_POSTS) return []
  const usual = median(measured.map((entry) => entry.value))
  if (!(usual > 0)) return []

  const tail = Math.floor(measured.length * GATE_PERFORMANCE_TAIL_SHARE)
  const excluded = opts.excludeItemIds ?? new Set<string>()
  const toExample = (
    entry: (typeof measured)[number],
    outcome: GatePerformanceExample['outcome'],
  ): GatePerformanceExample => ({
    itemId: entry.post.itemId,
    title: entry.post.title,
    source: entry.post.source,
    outcome,
    multiple: Math.round((entry.value / usual) * 10) / 10,
  })
  const pick = (
    entries: readonly (typeof measured)[number][],
    outcome: GatePerformanceExample['outcome'],
    isClear: (multiple: number) => boolean,
    cap: number,
  ) =>
    entries
      .filter((entry) => !excluded.has(entry.post.itemId) && isClear(entry.value / usual))
      .slice(0, Math.min(cap, GATE_PERFORMANCE_MAX_PER_SIDE))
      .map((entry) => toExample(entry, outcome))

  const winners = pick(
    measured.slice(0, tail),
    'winner',
    (multiple) => multiple >= GATE_PERFORMANCE_WINNER_MIN_MULTIPLE,
    Math.ceil(limit / 2),
  )
  const losers = pick(
    measured.slice(measured.length - tail).reverse(),
    'loser',
    (multiple) => multiple <= GATE_PERFORMANCE_LOSER_MAX_MULTIPLE,
    Math.floor(limit / 2),
  )
  return [...winners, ...losers]
}
