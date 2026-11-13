import { topicSlug } from '@/lib/reel-url'
import { topicLabel } from '@/lib/seo/site'
import { TOPICS } from '@/lib/topics'

export type FeedTab = { slug: string; label: string }

export const MAX_TOPIC_TABS = 3
export const MAX_FOLLOWED_TOPICS = 8

/** The viewer's followed topics first (when they have reels), then the most popular ones. */
export function pickFeedTabs(input: {
  followed: readonly string[]
  groups: readonly { slug: string; label: string }[]
  max?: number
}): FeedTab[] {
  const max = input.max ?? MAX_TOPIC_TABS
  const bySlug = new Map(input.groups.map((g) => [g.slug, g]))
  const tabs: FeedTab[] = []
  const add = (group: { slug: string; label: string } | undefined) => {
    if (group && tabs.length < max && !tabs.some((t) => t.slug === group.slug)) {
      tabs.push({ slug: group.slug, label: group.label })
    }
  }
  for (const topic of input.followed) add(bySlug.get(topicSlug(topic)))
  for (const group of input.groups) add(group)
  return tabs
}

const FOLLOWABLE = new Set<string>(TOPICS)

/** The reel topic to offer as "Follow": a picker topic when it has one, else its first topic. */
export function followableTopic(itemTopics: readonly string[]): FeedTab | null {
  const named = itemTopics.map((t) => ({ slug: topicSlug(t), label: topicLabel(t) }))
  return named.find((t) => FOLLOWABLE.has(t.slug)) ?? named.find((t) => t.slug) ?? null
}

/** The new followed list, or null when the topic is already followed or the list is full. */
export function withFollowed(current: readonly string[], slug: string): string[] | null {
  if (current.includes(slug) || current.length >= MAX_FOLLOWED_TOPICS) return null
  return [...current, slug]
}
