import { describe, expect, it } from 'vitest'
import { EMBEDDING_DIMENSIONS } from '@reelset/core'
import {
  GeminiError,
  createEmbedder,
  embeddingCostUsd,
  normalizeVector,
  parseEmbedResponse,
} from '../src/pipeline/gemini'
import { json, testLog, useFetch } from './helpers/mock-fetch'

describe('embeddings', () => {
  const vector = (seed: number) =>
    Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i === 0 ? seed : 0))

  it('normalises vectors to unit length', () => {
    const [v] = parseEmbedResponse({ embeddings: [{ values: vector(3) }] }, 1)
    expect(v![0]).toBeCloseTo(1)
    expect(normalizeVector([0, 0])).toEqual([0, 0])
  })
  it('rejects wrong counts and dimensions', () => {
    expect(() => parseEmbedResponse({ embeddings: [{ values: vector(1) }] }, 2)).toThrow(
      /expected 2/,
    )
    expect(() => parseEmbedResponse({ embeddings: [{ values: [1, 2, 3] }] }, 1)).toThrow(
      /dimensions/,
    )
    expect(() => parseEmbedResponse({}, 1)).toThrow(GeminiError)
  })
  it('requests 768 dimensions via batchEmbedContents', async () => {
    const { mock } = useFetch((url) =>
      url.includes(':batchEmbedContents')
        ? json({ embeddings: [{ values: vector(2) }, { values: vector(5) }] })
        : undefined,
    )
    const out = await createEmbedder('key', 'gemini-embedding-001', testLog).embed(['a', 'b'])
    expect(out).toHaveLength(2)
    const body = JSON.parse(String(mock.mock.calls[0]![1]!.body))
    expect(body.requests[0].outputDimensionality).toBe(768)
    expect(body.requests[0].model).toBe('models/gemini-embedding-001')
    expect(new Headers(mock.mock.calls[0]![1]!.headers).get('x-goog-api-key')).toBe('key')
  })
  it('surfaces http failures after retries', async () => {
    useFetch(() => new Response('upstream', { status: 503 }))
    await expect(createEmbedder('k', 'm', testLog).embed(['a'])).rejects.toThrow(/HTTP 503/)
  })
  it('estimates embedding cost', () => {
    expect(embeddingCostUsd(1_000_000)).toBeCloseTo(0.15)
  })
})
