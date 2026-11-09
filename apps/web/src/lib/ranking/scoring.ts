export const PERSONALIZE_MIN_SIGNALS = 10
export const SIMILARITY_WEIGHT = 0.6
export const FRESHNESS_WEIGHT = 0.25
export const POPULARITY_WEIGHT = 0.15
export const FRESHNESS_HALF_LIFE_HOURS = 48
export const TOPIC_BOOST = 0.2
export const STALE_AFTER_DAYS = 7
export const STALE_HALF_LIFE_DAYS = 3
export const EXPLORATION_EVERY = 5

export type Candidate = {
  id: string
  score: number
  publishedAt: Date
  topics: string[]
  similarity: number | null
}

export type RankContext = {
  asOf: Date
  signalCount: number
  profileTopics: string[]
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

export function freshness(publishedAt: Date, asOf: Date): number {
  const ageHours = Math.max(0, (asOf.getTime() - publishedAt.getTime()) / 3_600_000)
  return Math.pow(0.5, ageHours / FRESHNESS_HALF_LIFE_HOURS)
}

export function stalePenalty(publishedAt: Date, asOf: Date): number {
  const ageDays = Math.max(0, (asOf.getTime() - publishedAt.getTime()) / 86_400_000)
  if (ageDays <= STALE_AFTER_DAYS) return 1
  return Math.pow(0.5, (ageDays - STALE_AFTER_DAYS) / STALE_HALF_LIFE_DAYS)
}

export function isPersonalized(signalCount: number): boolean {
  return signalCount >= PERSONALIZE_MIN_SIGNALS
}

export function personalizedScore(similarity: number | null, fresh: number, itemScore: number) {
  return (
    SIMILARITY_WEIGHT * clamp01(similarity ?? 0) +
    FRESHNESS_WEIGHT * clamp01(fresh) +
    POPULARITY_WEIGHT * clamp01(itemScore)
  )
}

export function popularityScore(itemScore: number, fresh: number): number {
  return 0.6 * clamp01(itemScore) + 0.4 * clamp01(fresh)
}

export function topicOverlap(itemTopics: readonly string[], profileTopics: readonly string[]) {
  return itemTopics.some((t) => profileTopics.includes(t))
}

export function coldStartScore(c: Candidate, ctx: RankContext): number {
  const base = popularityScore(c.score, freshness(c.publishedAt, ctx.asOf))
  return topicOverlap(c.topics, ctx.profileTopics) ? base + TOPIC_BOOST : base
}

export function mainScore(c: Candidate, ctx: RankContext): number {
  const base = isPersonalized(ctx.signalCount)
    ? personalizedScore(c.similarity, freshness(c.publishedAt, ctx.asOf), c.score)
    : coldStartScore(c, ctx)
  return base * stalePenalty(c.publishedAt, ctx.asOf)
}

function byScoreThenId(a: { id: string; value: number }, b: { id: string; value: number }) {
  if (b.value !== a.value) return b.value - a.value
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

export function sortByScore(
  candidates: readonly Candidate[],
  scorer: (c: Candidate) => number,
): string[] {
  return candidates
    .map((c) => ({ id: c.id, value: scorer(c) }))
    .sort(byScoreThenId)
    .map((entry) => entry.id)
}

// Every `every`-th slot (the last of each group) is reserved for an exploration id. When one list
// runs dry the other fills the slot, and an id already placed is never repeated.
export function interleave(
  main: readonly string[],
  exploration: readonly string[],
  every = EXPLORATION_EVERY,
): string[] {
  const placed = new Set<string>()
  const out: string[] = []
  let m = 0
  let e = 0

  const next = (list: readonly string[], index: number): [string | null, number] => {
    let i = index
    while (i < list.length && placed.has(list[i] as string)) i++
    return i < list.length ? [list[i] as string, i + 1] : [null, i]
  }

  for (;;) {
    const wantExploration = out.length % every === every - 1
    let id: string | null = null
    if (wantExploration) {
      ;[id, e] = next(exploration, e)
      if (id === null) [id, m] = next(main, m)
    } else {
      ;[id, m] = next(main, m)
      if (id === null) [id, e] = next(exploration, e)
    }
    if (id === null) return out
    placed.add(id)
    out.push(id)
  }
}

export function rankCandidates(candidates: readonly Candidate[], ctx: RankContext): string[] {
  const main = sortByScore(candidates, (c) => mainScore(c, ctx))
  if (!isPersonalized(ctx.signalCount)) return main

  const popular = sortByScore(candidates, (c) =>
    popularityScore(c.score, freshness(c.publishedAt, ctx.asOf)),
  )
  return interleave(main, popular)
}
