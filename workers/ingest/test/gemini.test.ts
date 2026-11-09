import { describe, expect, it } from 'vitest'
import { EMBEDDING_DIMENSIONS } from '@reelset/core'
import {
  GeminiError,
  createEmbedder,
  createLlmClient,
  embeddingCostUsd,
  llmCostUsd,
  normalizeVector,
  parseEmbedResponse,
  parseGenerateResponse,
  parseModelOutput,
} from '../src/pipeline/gemini'
import { json, testLog, useFetch } from './helpers/mock-fetch'

const CHUNK = '11111111-1111-4111-8111-111111111111'
const validOutput = {
  tldr: 'A short summary.',
  topics: ['Queues', 'queues', 'Workers'],
  script: {
    version: 1,
    hook: 'Hook',
    beats: [
      { text: 'One', visual: { type: 'title', title: 'T' } },
      { text: 'Two', visual: { type: 'stat', label: 'L', value: '1' } },
    ],
    outro: 'Bye',
    claims: [{ text: 'Claim', chunkIds: [CHUNK] }],
  },
}

describe('parseModelOutput', () => {
  it('parses valid JSON and dedupes lowercase topics', () => {
    const result = parseModelOutput(JSON.stringify(validOutput))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.topics).toEqual(['queues', 'workers'])
  })
  it('strips markdown fences', () => {
    expect(parseModelOutput('```json\n' + JSON.stringify(validOutput) + '\n```').ok).toBe(true)
  })
  it('reports invalid JSON', () => {
    const result = parseModelOutput('Sure! Here is your script: {')
    expect(result).toEqual({ ok: false, reason: 'response was not valid JSON' })
  })
  it('reports schema mismatches with the failing paths', () => {
    const bad = {
      ...validOutput,
      script: { ...validOutput.script, beats: [validOutput.script.beats[0]] },
    }
    const result = parseModelOutput(JSON.stringify(bad))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('script.beats')
  })
  it('trims a tldr over 280 chars at a word boundary instead of rejecting it', () => {
    const result = parseModelOutput(JSON.stringify({ ...validOutput, tldr: 'word '.repeat(100) }))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.tldr.length).toBeLessThanOrEqual(280)
  })
  it('rejects non-uuid chunk ids', () => {
    const bad = {
      ...validOutput,
      script: { ...validOutput.script, claims: [{ text: 'c', chunkIds: ['chunk-1'] }] },
    }
    expect(parseModelOutput(JSON.stringify(bad)).ok).toBe(false)
  })
})

describe('parseGenerateResponse', () => {
  it('extracts text and usage', () => {
    const result = parseGenerateResponse({
      candidates: [{ content: { parts: [{ text: '{"a":' }, { text: '1}' }] } }],
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20 },
    })
    expect(result).toEqual({ text: '{"a":1}', usage: { inputTokens: 100, outputTokens: 20 } })
  })
  it('throws on blocked prompts, empty candidates and bad shapes', () => {
    expect(() => parseGenerateResponse({ promptFeedback: { blockReason: 'SAFETY' } })).toThrow(
      /blocked/,
    )
    expect(() => parseGenerateResponse({ candidates: [{ finishReason: 'MAX_TOKENS' }] })).toThrow(
      /MAX_TOKENS/,
    )
    expect(() => parseGenerateResponse('nope')).toThrow(GeminiError)
  })
})

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
})

describe('llm client and costs', () => {
  it('sends JSON mode requests and the key in a header, not the url', async () => {
    const { mock, calls } = useFetch(() =>
      json({
        candidates: [{ content: { parts: [{ text: '{}' }] } }],
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
      }),
    )
    await createLlmClient('secret-key', 'gemini-2.5-flash', testLog).generate({
      system: 's',
      user: 'u',
    })
    expect(calls[0]).toContain('/models/gemini-2.5-flash:generateContent')
    expect(calls[0]).not.toContain('secret-key')
    const body = JSON.parse(String(mock.mock.calls[0]![1]!.body))
    expect(body.generationConfig.responseMimeType).toBe('application/json')
    expect(body.systemInstruction.parts[0].text).toBe('s')
  })
  it('surfaces http failures after retries', async () => {
    useFetch(() => new Response('upstream', { status: 503 }))
    await expect(
      createLlmClient('k', 'm', testLog).generate({ system: 's', user: 'u' }),
    ).rejects.toThrow(/HTTP 503/)
  })
  it('estimates costs', () => {
    expect(llmCostUsd({ inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBeCloseTo(2.8)
    expect(embeddingCostUsd(1_000_000)).toBeCloseTo(0.15)
  })
})
