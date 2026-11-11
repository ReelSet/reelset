import { EMBEDDING_DIMENSIONS, type Logger } from '@reelset/core'
import { z } from 'zod'
import { fetchJson } from '../http'
import { asQuotaError } from './quota'

// Gemini is used for embeddings only; scripts and image vetting run on Claude.
const BASE = 'https://generativelanguage.googleapis.com/v1beta'

export class GeminiError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GeminiError'
  }
}

// USD per 1M tokens for gemini-embedding-001. Estimate for spend tracking, not billing.
const EMBEDDING_PRICE_PER_M = 0.15

export function approxTokens(texts: readonly string[]): number {
  return Math.ceil(texts.reduce((n, t) => n + t.length, 0) / 4)
}

export function embeddingCostUsd(tokens: number): number {
  return (tokens * EMBEDDING_PRICE_PER_M) / 1_000_000
}

async function geminiJson(
  url: string,
  log: Logger,
  options: Parameters<typeof fetchJson>[2],
): Promise<unknown> {
  try {
    return await fetchJson(url, log, options)
  } catch (err) {
    throw asQuotaError(err)
  }
}

export function normalizeVector(values: readonly number[]): number[] {
  const norm = Math.sqrt(values.reduce((sum, v) => sum + v * v, 0))
  return norm === 0 ? [...values] : values.map((v) => v / norm)
}

const embedResponseSchema = z.looseObject({
  embeddings: z.array(z.looseObject({ values: z.array(z.number()) })),
})

export function parseEmbedResponse(json: unknown, expected: number): number[][] {
  const parsed = embedResponseSchema.safeParse(json)
  if (!parsed.success) throw new GeminiError('unexpected batchEmbedContents response shape')
  const vectors = parsed.data.embeddings.map((e) => e.values)
  if (vectors.length !== expected) {
    throw new GeminiError(`expected ${expected} embeddings, got ${vectors.length}`)
  }
  for (const v of vectors) {
    if (v.length !== EMBEDDING_DIMENSIONS) {
      throw new GeminiError(`expected ${EMBEDDING_DIMENSIONS} dimensions, got ${v.length}`)
    }
  }
  return vectors.map(normalizeVector)
}

export type Embedder = {
  embed: (texts: readonly string[]) => Promise<number[][]>
}

export function createEmbedder(apiKey: string, model: string, log: Logger): Embedder {
  return {
    embed: async (texts) => {
      if (texts.length === 0) return []
      const json = await geminiJson(`${BASE}/models/${model}:batchEmbedContents`, log, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          requests: texts.map((text) => ({
            model: `models/${model}`,
            content: { parts: [{ text }] },
            taskType: 'RETRIEVAL_DOCUMENT',
            outputDimensionality: EMBEDDING_DIMENSIONS,
          })),
        }),
        timeoutMs: 60_000,
        hostIntervalMs: 0,
      })
      return parseEmbedResponse(json, texts.length)
    },
  }
}
