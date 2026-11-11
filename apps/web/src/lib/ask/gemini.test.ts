import { createLogger } from '@reelset/core'
import { describe, expect, it, vi } from 'vitest'
import { GeminiError, embedQuestion, parseEmbedResponse } from './gemini'
import { isProviderUnavailable } from './provider-error'

const log = createLogger({ app: 'test', level: 'silent' })
const config = { apiKey: 'secret-key', embeddingModel: 'models/embed-test' }

describe('parseEmbedResponse', () => {
  it('requires exactly 768 dimensions', () => {
    expect(parseEmbedResponse({ embedding: { values: new Array(768).fill(0.1) } })).toHaveLength(
      768,
    )
    expect(() => parseEmbedResponse({ embedding: { values: [1, 2] } })).toThrow(GeminiError)
    expect(() => parseEmbedResponse({})).toThrow(GeminiError)
  })
})

describe('embedQuestion', () => {
  it('embeds with 768 dimensions and sends the key in a header, not the url', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ embedding: { values: new Array(768).fill(0) } }),
    )
    const out = await embedQuestion(config, 'hello', log, fetchMock as unknown as typeof fetch)
    expect(out).toHaveLength(768)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('/models/embed-test:embedContent')
    expect(url).not.toContain('secret-key')
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('secret-key')
    const body = JSON.parse(init.body as string)
    expect(body).toMatchObject({ taskType: 'RETRIEVAL_QUERY', outputDimensionality: 768 })
  })

  it.each([
    [503, true],
    [429, true],
    [400, false],
  ])('throws GeminiError with status %s (unavailable=%s)', async (status, unavailable) => {
    const fetchMock = vi.fn(async () => new Response('boom', { status }))
    const err = await embedQuestion(
      config,
      'hello',
      log,
      fetchMock as unknown as typeof fetch,
    ).catch((e: unknown) => e)
    expect(err).toMatchObject({ name: 'GeminiError', status })
    expect(isProviderUnavailable(err)).toBe(unavailable)
  })

  it('wraps network errors as unavailable', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('fetch failed')
    })
    const err = await embedQuestion(
      config,
      'hello',
      log,
      fetchMock as unknown as typeof fetch,
    ).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(GeminiError)
    expect(isProviderUnavailable(err)).toBe(true)
  })
})
