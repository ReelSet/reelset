import { topicSlug } from '@/lib/reel-url'
import { topicLabel } from './site'
import type { ReelSummary, TopicCount } from './types'

export const SOURCE_ORDER = ['hn', 'github', 'reddit', 'youtube', 'papers', 'news'] as const

export type SourceChip = { source: string | null; count: number; active: boolean; href: string }
export type Shelf = { topic: TopicCount; reels: ReelSummary[] }

export function filterHref(path: string, source: string | null): string {
  return source ? `${path}?source=${source}` : path
}

/** "All" plus every source that has reels, in a fixed order so chips never jump around. */
export function sourceChips(input: {
  path: string
  total: number
  counts: { source: string; count: number }[]
  active: string | null
}): SourceChip[] {
  const bySource = new Map(input.counts.map((c) => [c.source, c.count]))
  const chips: SourceChip[] = [
    { source: null, count: input.total, active: input.active === null, href: input.path },
  ]
  for (const source of SOURCE_ORDER) {
    const count = bySource.get(source) ?? 0
    if (count > 0 || input.active === source) {
      chips.push({
        source,
        count,
        active: input.active === source,
        href: filterHref(input.path, source),
      })
    }
  }
  return chips
}

/** One row per busiest topic, newest reels first; topics with too few reels are skipped. */
export function buildShelves(
  reels: ReelSummary[],
  topics: TopicCount[],
  opts: { shelves: number; perShelf: number; minReels: number },
): Shelf[] {
  const shelves: Shelf[] = []
  for (const topic of topics) {
    if (shelves.length >= opts.shelves) break
    const matching = reels.filter((r) => r.topics.some((t) => topicSlug(t) === topic.slug))
    if (matching.length >= opts.minReels) {
      shelves.push({ topic, reels: matching.slice(0, opts.perShelf) })
    }
  }
  return shelves
}

/** Topics that show up alongside this one, most shared first. */
export function relatedTopics(reels: ReelSummary[], slug: string, limit: number): TopicCount[] {
  const counts = new Map<string, TopicCount>()
  for (const reel of reels) {
    const seen = new Set<string>()
    for (const raw of reel.topics) {
      const s = topicSlug(raw)
      if (!s || s === slug || seen.has(s)) continue
      seen.add(s)
      const entry = counts.get(s)
      if (entry) entry.count += 1
      else counts.set(s, { slug: s, label: topicLabel(raw), count: 1 })
    }
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.slug.localeCompare(b.slug))
    .slice(0, limit)
}

/** Under a source filter, cards name that source rather than the reel's top-scored one. */
export function asSeenOn(reels: ReelSummary[], source: string | null): ReelSummary[] {
  return source ? reels.map((r) => ({ ...r, source })) : reels
}

/** Video length as a clock: 65s -> "1:05". */
export function clockDuration(ms: number | null | undefined): string | null {
  if (!ms || ms <= 0) return null
  const total = Math.round(ms / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}
