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
  const byItem = new Map<string, RelatedReelDto>()
  for (const citation of citations) {
    const itemId = chunkItems.get(citation.chunkId)
    if (!itemId) continue
    const existing = byItem.get(itemId)
    if (existing) {
      existing.chunkIds?.push(citation.chunkId)
      continue
    }
    const reel = reels.get(itemId)
    if (!reel || byItem.size >= limit) continue
    byItem.set(itemId, {
      itemId,
      title: reel.title,
      posterUrl: posterUrl(reel.poster_key),
      source: reel.source ?? 'news',
      chunkIds: [citation.chunkId],
    })
  }
  return [...byItem.values()]
}
