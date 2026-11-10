import type { ReelProps, ScreenName } from './types'

/** Source cards that get distinct looks; each look is used once and the card at most 3 times. */
export const SOURCE_SCREENS = new Set<ScreenName>(['HNThread', 'RedditPost', 'PaperPage'])
export const SOURCE_CAP = 3

/** Counts below these are weak social proof and are not slammed as big numbers. */
export const STATS_FLOOR = { hn: 100, reddit: 300, comments: 80 } as const

export type SourceVariant = 'title' | 'comment' | 'stats' | 'abstract' | 'figure'

const hasFigure = (props: Pick<ReelProps, 'images'>) =>
  (props.images ?? []).some((i) => i.kind === 'figure')

/** The looks this item can honestly fill, in the order they should appear. */
export function sourceVariants(
  show: ScreenName,
  props: Pick<ReelProps, 'facts' | 'images' | 'scenes'>,
  quoteHere = false,
): SourceVariant[] {
  const f = props.facts ?? {}
  const quoteVisual = quoteHere
  if (show === 'HNThread') {
    const out: SourceVariant[] = ['title']
    if (f.hn?.topComment || quoteVisual) out.push('comment')
    if ((f.hn?.points ?? 0) >= STATS_FLOOR.hn || (f.hn?.comments ?? 0) >= STATS_FLOOR.comments)
      out.push('stats')
    return out
  }
  if (show === 'RedditPost') {
    const out: SourceVariant[] = ['title']
    if (f.reddit?.topComment || f.reddit?.text || quoteVisual) out.push('comment')
    if (
      (f.reddit?.upvotes ?? 0) >= STATS_FLOOR.reddit ||
      (f.reddit?.comments ?? 0) >= STATS_FLOOR.comments
    )
      out.push('stats')
    return out
  }
  if (show === 'PaperPage') {
    const out: SourceVariant[] = ['title', 'abstract']
    if (hasFigure(props)) out.push('figure')
    return out
  }
  return []
}

export const variantOf = (props: Record<string, unknown>): SourceVariant | undefined =>
  typeof props.variant === 'string' ? (props.variant as SourceVariant) : undefined

/** Next unused look for a source card, or null when every look (or the cap) is spent. */
export function nextVariant(
  show: ScreenName,
  props: Pick<ReelProps, 'facts' | 'images' | 'scenes'>,
  used: readonly string[],
  prefer?: SourceVariant,
  quoteHere = false,
): SourceVariant | null {
  if (used.length >= SOURCE_CAP) return null
  const free = sourceVariants(show, props, quoteHere || prefer === 'comment').filter(
    (v) => !used.includes(v),
  )
  if (prefer && free.includes(prefer)) return prefer
  return free[0] ?? null
}

/** Quote for a comment card: the item's real top comment, else the scene's quoted line. */
export function commentFor(
  show: ScreenName,
  props: Pick<ReelProps, 'facts'>,
  sceneQuote?: { text: string; attribution: string },
): { quote: string; by: string } | null {
  const f = props.facts ?? {}
  if (show === 'HNThread' && f.hn?.topComment) return { quote: f.hn.topComment, by: 'top comment' }
  if (show === 'RedditPost' && f.reddit?.topComment)
    return { quote: f.reddit.topComment, by: 'top comment' }
  if (sceneQuote) return { quote: sceneQuote.text, by: sceneQuote.attribution }
  if (show === 'RedditPost' && f.reddit?.text)
    return { quote: f.reddit.text, by: f.reddit.author ? `u/${f.reddit.author}` : 'post' }
  return null
}
