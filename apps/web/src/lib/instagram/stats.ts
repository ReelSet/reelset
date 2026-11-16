export type PostStats = {
  like_count: number | null
  comments_count: number | null
  view_count: number | null
  shares?: number | null
  saves?: number | null
}

export const INSIGHTS_PERMISSION_NOTE =
  'Views are not available yet: the access token lacks the instagram_manage_insights permission. Add it to the Meta app configuration, generate a new token and save it above. Likes and comments work without it.'

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })

const part = (count: number | null, one: string, many: string) =>
  count === null ? null : `${compact.format(count)} ${count === 1 ? one : many}`

/** The numbers Instagram has reported for a post, in display order; empty before the first sync. */
export function statsParts(stats: PostStats): string[] {
  return [
    part(stats.view_count, 'view', 'views'),
    part(stats.like_count, 'like', 'likes'),
    part(stats.comments_count, 'comment', 'comments'),
    stats.shares ? part(stats.shares, 'share', 'shares') : null,
    stats.saves ? part(stats.saves, 'save', 'saves') : null,
  ].filter((p): p is string => p !== null)
}
