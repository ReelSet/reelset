import { EMBEDDING_DIMENSIONS, elapsedMs, errorFields, type Logger } from '@reelset/core'
import { z } from 'zod'
import { ProviderError, isUnavailableStatus } from './provider-error'

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta'
const REQUEST_TIMEOUT_MS = 25_000

export type GeminiEmbeddingConfig = { apiKey: string; embeddingModel: string }
type FetchLike = typeof fetch

export class GeminiError extends ProviderError {
  constructor(message: string, status?: number) {
    super(message, isUnavailableStatus(status), status)
    this.name = 'GeminiError'
  }
}

function modelPath(model: string): string {
  return model.startsWith('models/') ? model : `models/${model}`
}

const embedResponseSchema = z.object({
  embedding: z.object({ values: z.array(z.number()) }),
})

export function parseEmbedResponse(json: unknown): number[] {
  const parsed = embedResponseSchema.safeParse(json)
  if (!parsed.success) throw new GeminiError('malformed embedding response')
  const { values } = parsed.data.embedding
  if (values.length !== EMBEDDING_DIMENSIONS) {
    throw new GeminiError(`expected ${EMBEDDING_DIMENSIONS} dimensions, got ${values.length}`)
  }
  return values
}

async function postJson(
  url: string,
  apiKey: string,
  body: unknown,
  fetchImpl: FetchLike,
  log: Logger,
): Promise<unknown> {
  const started = performance.now()
  let response: Response
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (err) {
    log.error(
      { op: 'embed', durationMs: elapsedMs(started), ...errorFields(err) },
      'gemini request failed',
    )
    throw new GeminiError('embed request failed')
  }
  log.info(
    { op: 'embed', status: response.status, durationMs: elapsedMs(started) },
    'gemini response',
  )
  if (!response.ok) throw new GeminiError(`embed returned ${response.status}`, response.status)
  try {
    return await response.json()
  } catch {
    throw new GeminiError('embed returned non-JSON body', response.status)
  }
}

// Embeds an Ask question as a 768-dim RETRIEVAL_QUERY vector; throws GeminiError on any failure.
export async function embedQuestion(
  config: GeminiEmbeddingConfig,
  text: string,
  log: Logger,
  fetchImpl: FetchLike = fetch,
): Promise<number[]> {
  const url = `${API_BASE}/${modelPath(config.embeddingModel)}:embedContent`
  const json = await postJson(
    url,
    config.apiKey,
    {
      content: { parts: [{ text }] },
      taskType: 'RETRIEVAL_QUERY',
      outputDimensionality: EMBEDDING_DIMENSIONS,
    },
    fetchImpl,
    log,
  )
  return parseEmbedResponse(json)
}
