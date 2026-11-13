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

export type Citation = {
  chunkId: string
  title: string
  url: string
  publishedAt: string
  itemId: string
  // 1-based positions of the evidence chunks behind this source, matching the [n] marks in the answer.
  refs: number[]
}

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
  const byId = new Map(retrieved.map((chunk, i) => [chunk.id, { chunk, ref: i + 1 }]))
  // The prompt numbers chunks by n, so a bare number means the n-th chunk; ids are still accepted.
  const lookup = (id: string) => {
    const hit = byId.get(id)
    if (hit || !/^\d{1,3}$/.test(id)) return hit
    const chunk = retrieved[Number(id) - 1]
    return chunk ? { chunk, ref: Number(id) } : undefined
  }
  const byUrl = new Map<string, Citation>()
  const citations: Citation[] = []
  for (const id of chunkIds) {
    const hit = lookup(id)
    if (!hit) continue
    const { chunk, ref } = hit
    const existing = byUrl.get(chunk.url)
    if (existing) {
      if (!existing.refs.includes(ref)) existing.refs.push(ref)
      continue
    }
    const citation: Citation = {
      chunkId: chunk.id,
      title: chunk.title,
      url: chunk.url,
      publishedAt: chunk.publishedAt,
      itemId: chunk.itemId,
      refs: [ref],
    }
    byUrl.set(chunk.url, citation)
    citations.push(citation)
  }
  return citations
}
