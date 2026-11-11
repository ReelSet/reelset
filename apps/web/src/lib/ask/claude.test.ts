import Anthropic from '@anthropic-ai/sdk'
import { createLogger } from '@reelset/core'
import { describe, expect, it, vi } from 'vitest'
import {
  ClaudeError,
  ClaudeRefusalError,
  generateAnswer,
  toClaudeError,
  type AskModelConfig,
} from './claude'
import type { EvidenceChunk } from './evidence'
import { isProviderUnavailable } from './provider-error'

const log = createLogger({ app: 'test', level: 'silent' })
const config: AskModelConfig = { apiKey: 'sk-test', model: 'claude-haiku-5-5' }

const chunk: EvidenceChunk = {
  id: 'c1',
  itemId: 'i1',
  text: 'Bun benchmarks',
  title: 'Bun',
  url: 'https://x.test',
  publishedAt: '2026-11-01T00:00:00.000Z',
  similarity: 0.9,
}

type StreamEnd = { stopReason?: string; stopDetails?: Record<string, unknown> | null }

function sseEvents(textDeltas: string[], end: StreamEnd = {}): unknown[] {
  const message = {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-5-5',
    content: [],
    stop_reason: null,
    stop_sequence: null,
    usage: { input_tokens: 120, output_tokens: 1 },
  }
  return [
    { type: 'message_start', message },
    {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'thinking', thinking: '', signature: '' },
    },
    { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
    ...textDeltas.map((text) => ({
      type: 'content_block_delta',
      index: 1,
      delta: { type: 'text_delta', text },
    })),
    { type: 'content_block_stop', index: 1 },
    {
      type: 'message_delta',
      delta: {
        stop_reason: end.stopReason ?? 'end_turn',
        stop_sequence: null,
        stop_details: end.stopDetails ?? null,
      },
      usage: { output_tokens: 42 },
    },
    { type: 'message_stop' },
  ]
}

function sseResponse(events: unknown[]): Response {
  const body = events
    .map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`)
    .join('')
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } })
}

function mockFetch(handler: () => Response) {
  const calls: { url: string; body: Record<string, unknown>; headers: Headers }[] = []
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      headers: new Headers(init?.headers),
    })
    return handler()
  }) as unknown as typeof fetch
  return { fetchImpl, calls }
}

function apiError(status: number, text: string) {
  return Anthropic.APIError.generate(
    status,
    { type: 'error', error: { type: 'x', message: text } },
    text,
    new Headers(),
  )
}

describe('generateAnswer', () => {
  it('streams the answer without the citations trailer and reports usage', async () => {
    const { fetchImpl } = mockFetch(() =>
      sseResponse(sseEvents(['Bun is ', 'faster.\nCITA', 'TIONS: c1, ghost'])),
    )
    const deltas: string[] = []
    const out = await generateAnswer(config, 'q', [chunk], log, (t) => deltas.push(t), fetchImpl)
    expect(out.parsed).toEqual({ answer: 'Bun is faster.', citations: ['c1', 'ghost'] })
    expect(out).toMatchObject({ model: 'claude-haiku-5-5', inputTokens: 120, outputTokens: 42 })
    expect(deltas.join('')).toBe('Bun is faster.')
  })

  it('sends low effort, the ask system prompt and no parameters Haiku 5.5 rejects', async () => {
    const { fetchImpl, calls } = mockFetch(() => sseResponse(sseEvents(['x\nCITATIONS: c1'])))
    await generateAnswer(config, 'what?', [chunk], log, undefined, fetchImpl)
    const { body, headers, url } = calls[0]!
    expect(body).toMatchObject({ model: 'claude-haiku-5-5', stream: true, max_tokens: 8000 })
    expect(body.output_config).toEqual({ effort: 'low' })
    expect(body.system).toContain('CITATIONS:')
    const messages = body.messages as { role: string; content: string }[]
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({ role: 'user' })
    expect(messages[0]!.content).toContain('<chunk id="c1"')
    for (const banned of ['temperature', 'top_p', 'top_k', 'thinking']) {
      expect(body).not.toHaveProperty(banned)
    }
    expect(headers.get('authorization')).toBe('Bearer sk-test')
    expect(url).not.toContain('sk-test')
  })

  it('keeps parsed null when the model omits the citations line', async () => {
    const { fetchImpl } = mockFetch(() => sseResponse(sseEvents(['sorry, no format'])))
    const out = await generateAnswer(config, 'q', [chunk], log, undefined, fetchImpl)
    expect(out.parsed).toBeNull()
  })

  it('throws an unavailable ClaudeError on an empty answer', async () => {
    const { fetchImpl } = mockFetch(() => sseResponse(sseEvents([])))
    const err = await generateAnswer(config, 'q', [chunk], log, undefined, fetchImpl).catch(
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(ClaudeError)
    expect(isProviderUnavailable(err)).toBe(true)
  })

  it('throws a refusal that is not reported as unavailable', async () => {
    const { fetchImpl } = mockFetch(() =>
      sseResponse(
        sseEvents(['partial'], {
          stopReason: 'refusal',
          stopDetails: { type: 'refusal', category: 'cyber', explanation: null },
        }),
      ),
    )
    const err = await generateAnswer(config, 'q', [chunk], log, undefined, fetchImpl).catch(
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(ClaudeRefusalError)
    expect((err as ClaudeRefusalError).category).toBe('cyber')
    expect(isProviderUnavailable(err)).toBe(false)
  })

  it('reports a mid-stream overload as unavailable', async () => {
    const [start] = sseEvents([])
    const overloaded = { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }
    const { fetchImpl } = mockFetch(() => sseResponse([start, overloaded]))
    const err = await generateAnswer(config, 'q', [chunk], log, undefined, fetchImpl).catch(
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(ClaudeError)
    expect(isProviderUnavailable(err)).toBe(true)
  })

  it('maps an http error to ClaudeError with its status', async () => {
    const { fetchImpl } = mockFetch(() =>
      Response.json(
        { type: 'error', error: { type: 'invalid_request_error', message: 'bad' } },
        { status: 400 },
      ),
    )
    const err = await generateAnswer(config, 'q', [chunk], log, undefined, fetchImpl).catch(
      (e: unknown) => e,
    )
    expect(err).toMatchObject({ name: 'ClaudeError', status: 400, unavailable: false })
  })
})

describe('toClaudeError', () => {
  it.each([
    [401, 'invalid x-api-key'],
    [402, 'billing problem'],
    [403, 'forbidden'],
    [429, 'rate limited'],
    [529, 'overloaded'],
    [400, 'Your credit balance is too low to access the Anthropic API'],
  ])('marks %s as unavailable', (status, text) => {
    const mapped = toClaudeError(apiError(status, text))
    expect(mapped).toMatchObject({ name: 'ClaudeError', status, unavailable: true })
  })

  it('treats connection failures as unavailable', () => {
    const mapped = toClaudeError(new Anthropic.APIConnectionError({ message: 'socket hang up' }))
    expect(isProviderUnavailable(mapped)).toBe(true)
  })

  it('keeps plain bad requests and non-SDK errors out of unavailable', () => {
    expect(isProviderUnavailable(toClaudeError(apiError(400, 'messages: invalid')))).toBe(false)
    const plain = new Error('bug')
    expect(toClaudeError(plain)).toBe(plain)
  })
})
