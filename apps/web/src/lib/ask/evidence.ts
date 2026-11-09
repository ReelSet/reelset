export const ASK_TOP_K = 12
// Cosine similarity floor; below it a question counts as unanswered rather than guessed at.
export const ASK_MIN_SIMILARITY = 0.55

export type EvidenceChunk = {
  id: string
  itemId: string
  text: string
  title: string
  url: string
  publishedAt: string
  similarity: number
}

export type Citation = { chunkId: string; title: string; url: string; publishedAt: string }

export function selectEvidence(
  rows: readonly EvidenceChunk[],
  minSimilarity = ASK_MIN_SIMILARITY,
  limit = ASK_TOP_K,
): EvidenceChunk[] {
  return rows
    .filter((row) => Number.isFinite(row.similarity) && row.similarity >= minSimilarity)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit)
}

export function filterCitations(
  chunkIds: readonly string[],
  retrieved: readonly EvidenceChunk[],
): Citation[] {
  const byId = new Map(retrieved.map((chunk) => [chunk.id, chunk]))
  const seenUrls = new Set<string>()
  const citations: Citation[] = []
  for (const id of chunkIds) {
    const chunk = byId.get(id)
    if (!chunk || seenUrls.has(chunk.url)) continue
    seenUrls.add(chunk.url)
    citations.push({
      chunkId: chunk.id,
      title: chunk.title,
      url: chunk.url,
      publishedAt: chunk.publishedAt,
    })
  }
  return citations
}
