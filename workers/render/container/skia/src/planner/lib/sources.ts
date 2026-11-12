import type { ReelProps, ScreenName } from './types'

/** Source cards that get distinct looks; each look is used once and the card at most twice. */
export const SOURCE_SCREENS = new Set<ScreenName>(['HNThread', 'RedditPost', 'PaperPage'])
export const SOURCE_CAP = 2

/** Counts below these are weak social proof and are not slammed as big numbers. */
export const STATS_FLOOR = { hn: 100, reddit: 300, comments: 80 } as const

export type SourceVariant = 'title' | 'comment' | 'stats' | 'abstract' | 'figure'

const hasFigure = (props: Pick<ReelProps, 'images'>) =>
  (props.images ?? []).some((i) => i.kind === 'figure')

/**
 * The narration says this count ("521 points"): only then may it be the big number on screen.
 * Counts nobody mentions stay small on the title card.
 */
export function countSaid(props: Pick<ReelProps, 'scenes'>, n: number | undefined): boolean {
  if (n === undefined) return false
  const forms = [String(n), n.toLocaleString('en-US')]
  return props.scenes.some((sc) =>
    'text' in sc
      ? sc.text.split(/[\s()]+/).some((w) => forms.includes(w.replace(/[.,;:!?]+$/, '')))
      : false,
  )
}

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
    if (
      ((f.hn?.points ?? 0) >= STATS_FLOOR.hn && countSaid(props, f.hn?.points)) ||
      ((f.hn?.comments ?? 0) >= STATS_FLOOR.comments && countSaid(props, f.hn?.comments))
    )
      out.push('stats')
    return out
  }
  if (show === 'RedditPost') {
    const out: SourceVariant[] = ['title']
    if (f.reddit?.topComment || f.reddit?.text || quoteVisual) out.push('comment')
    if (
      ((f.reddit?.upvotes ?? 0) >= STATS_FLOOR.reddit && countSaid(props, f.reddit?.upvotes)) ||
      ((f.reddit?.comments ?? 0) >= STATS_FLOOR.comments && countSaid(props, f.reddit?.comments))
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

/**
 * A repo card with nothing but the name (no stored description, no star count) is a placeholder:
 * the reel shows the repo's real share card or other material instead.
 */
export const repoCardSparse = (props: Pick<ReelProps, 'facts'>): boolean => {
  const r = props.facts?.repo
  return !r?.description?.trim() && r?.stars === undefined && !r?.topics?.length
}

const flat = (t: string) =>
  t
    .toLowerCase()
    .replace(/[\u2018\u2019']/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

/**
 * Words shown in quote marks must be somebody's words: the quote is found verbatim (case and
 * punctuation aside) in the source material (claims, abstract, top comment, post, description,
 * title). The narration is our own script and never counts.
 */
export function isSourcedQuote(
  quote: string,
  props: Pick<ReelProps, 'claims' | 'facts' | 'title'>,
): boolean {
  const q = flat(quote)
  if (q.split(' ').length < 2) return false
  const f = props.facts ?? {}
  const corpus = [
    ...(props.claims ?? []),
    props.title,
    f.paper?.abstract ?? '',
    f.hn?.topComment ?? '',
    f.reddit?.text ?? '',
    f.reddit?.topComment ?? '',
    f.repo?.description ?? '',
  ]
  return corpus.some((t) => t && flat(t).includes(q))
}

export const SOURCE_LABELS: Record<ReelProps['source'], string> = {
  hn: 'Hacker News',
  github: 'GitHub',
  news: 'News',
  reddit: 'Reddit',
  youtube: 'YouTube',
  papers: 'Research',
}

/**
 * What the reel is about decides its source look, not where it was discovered: a GitHub repo found
 * through a Reddit post is a GitHub reel (chip, repo card, demo), an arXiv link found on HN a paper.
 */
export function withPrimarySource<T extends Pick<ReelProps, 'source' | 'sourceLabel' | 'domain'>>(
  props: T,
): T {
  const host = props.domain.toLowerCase().replace(/^www\./, '')
  const primary: ReelProps['source'] | null =
    host === 'github.com'
      ? 'github'
      : host === 'arxiv.org'
        ? 'papers'
        : host === 'youtube.com' || host === 'youtu.be'
          ? 'youtube'
          : null
  if (!primary || primary === props.source) return props
  return { ...props, source: primary, sourceLabel: SOURCE_LABELS[primary] }
}
