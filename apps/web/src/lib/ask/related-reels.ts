import type { CitationDto, RelatedReelDto } from '@/lib/api-types'

export const MAX_RELATED_REELS = 8

export type ReelRow = {
  id: string
  title: string
  poster_key: string | null
  source: string | null
}

export function pickRelatedReels(
  citations: readonly Pick<CitationDto, 'chunkId'>[],
  chunkItems: ReadonlyMap<string, string>,
  reels: ReadonlyMap<string, ReelRow>,
  posterUrl: (key: string | null) => string | null,
  limit = MAX_RELATED_REELS,
): RelatedReelDto[] {
  const seen = new Set<string>()
  const out: RelatedReelDto[] = []
  for (const citation of citations) {
    const itemId = chunkItems.get(citation.chunkId)
    if (!itemId || seen.has(itemId)) continue
    const reel = reels.get(itemId)
    if (!reel) continue
    seen.add(itemId)
    out.push({
      itemId,
      title: reel.title,
      posterUrl: posterUrl(reel.poster_key),
      source: reel.source ?? 'news',
    })
    if (out.length >= limit) break
  }
  return out
}
