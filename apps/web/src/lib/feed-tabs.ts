import { topicSlug } from '@/lib/reel-url'
import { topicLabel } from '@/lib/seo/site'
import { MAX_FOLLOWED_TOPICS, TOPICS } from '@/lib/topics'

export type FeedTab = { slug: string; label: string }

const FOLLOWABLE = new Set<string>(TOPICS)

/** The reel topic to offer as "Follow": a picker topic when it has one, else its first topic. */
export function followableTopic(itemTopics: readonly string[]): FeedTab | null {
  const named = itemTopics.map((t) => ({ slug: topicSlug(t), label: topicLabel(t) }))
  return named.find((t) => FOLLOWABLE.has(t.slug)) ?? named.find((t) => t.slug) ?? null
}
