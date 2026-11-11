import { describe, expect, it, vi } from 'vitest'
import Anthropic from '@anthropic-ai/sdk'
import {
  ClaudeError,
  ClaudeRefusalError,
  asClaudeQuotaError,
  createClaudeClient,
  parseClaudeMessage,
} from '../src/pipeline/claude'
import { createLlm } from '../src/pipeline/llm'
import { QuotaExhaustedError } from '../src/pipeline/quota'
import { json, testLog } from './helpers/mock-fetch'

const message = (over: Record<string, unknown> = {}) => ({
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: 'claude-haiku-5-5',
  content: [
    { type: 'thinking', thinking: '', signature: 'sig' },
    { type: 'text', text: '{"ok":true}' },
  ],
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 0 },
  ...over,
})

function client(handler: (body: Record<string, unknown>) => Response) {
  const calls: { url: string; body: Record<string, unknown>; headers: Headers }[] = []
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    calls.push({ url: String(input), body, headers: new Headers(init?.headers) })
    return handler(body)
  }) as unknown as typeof fetch
  return {
    llm: createClaudeClient('sk-test', 'claude-haiku-5-5', testLog, { fetch: fetchImpl }),
    calls,
  }
}

describe('createClaudeClient request building', () => {
  it('sends a cacheable system block, one user turn, effort, and no banned parameters', async () => {
    const { llm, calls } = client(() => json(message()))
    await llm.generate({ system: 'SYSTEM', user: 'USER' })
    const body = calls[0]!.body
    expect(body.model).toBe('claude-haiku-5-5')
    expect(body.system).toEqual([
      { type: 'text', text: 'SYSTEM', cache_control: { type: 'ephemeral' } },
    ])
    expect(body.messages).toEqual([{ role: 'user', content: 'USER' }])
    expect(body.output_config).toEqual({ effort: 'medium' })
    for (const banned of ['temperature', 'top_p', 'top_k', 'thinking']) {
      expect(body).not.toHaveProperty(banned)
    }
    expect((body.messages as { role: string }[]).at(-1)?.role).toBe('user')
    expect([...calls[0]!.headers.entries()].flat().join(' ')).toContain('sk-test')
    expect(calls[0]!.url).not.toContain('sk-test')
  })

  it('honours an explicit effort', async () => {
    const calls: Record<string, unknown>[] = []
    const fetchImpl = (async (_u: unknown, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body)))
      return json(message())
    }) as unknown as typeof fetch
    await createClaudeClient('k', 'claude-haiku-5-5', testLog, {
      fetch: fetchImpl,
      effort: 'high',
    }).generate({ system: 's', user: 'u' })
    expect(calls[0]!.output_config).toEqual({ effort: 'high' })
  })

  it('puts attached images before the text as base64 blocks, skipping unsupported types', async () => {
    const { llm, calls } = client(() => json(message()))
    await llm.generate({
      system: 's',
      user: 'USER',
      images: [
        { mime: 'image/jpg', base64: 'AAA' },
        { mime: 'image/svg+xml', base64: 'BBB' },
        { mime: 'image/png', base64: 'CCC' },
      ],
    })
    const content = (calls[0]!.body.messages as { content: unknown }[])[0]!.content
    expect(content).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAA' } },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'CCC' } },
      { type: 'text', text: 'USER' },
    ])
  })

  it('retries text only when the API rejects an attached image', async () => {
    const { llm, calls } = client((body) => {
      const content = (body.messages as { content: unknown }[])[0]!.content
      if (Array.isArray(content)) {
        return json(
          {
            type: 'error',
            error: { type: 'invalid_request_error', message: 'image exceeds 5 MB maximum' },
          },
          400,
        )
      }
      return json(message())
    })
    const out = await llm.generate({
      system: 's',
      user: 'USER',
      images: [{ mime: 'image/png', base64: 'AAA' }],
    })
    expect(out.text).toBe('{"ok":true}')
    expect(calls).toHaveLength(2)
    expect((calls[1]!.body.messages as { content: unknown }[])[0]!.content).toBe('USER')
  })
})

describe('parseClaudeMessage', () => {
  it('reads text blocks by type, skipping thinking, and maps usage', () => {
    const parsed = parseClaudeMessage({
      content: [
        { type: 'thinking' },
        { type: 'text', text: '{"a":' },
        { type: 'text', text: '1}' },
      ],
      stop_reason: 'end_turn',
      usage: {
        input_tokens: 10,
        output_tokens: 20,
        cache_read_input_tokens: 5,
        cache_creation_input_tokens: 7,
      },
    })
    expect(parsed.text).toBe('{"a":1}')
    expect(parsed.usage).toEqual({
      inputTokens: 10,
      outputTokens: 20,
      cacheReadTokens: 5,
      cacheWriteTokens: 7,
    })
  })

  it('throws a refusal error with the category', () => {
    expect(() =>
      parseClaudeMessage({
        content: [],
        stop_reason: 'refusal',
        stop_details: { category: 'general_harms' },
        usage: {},
      }),
    ).toThrow(ClaudeRefusalError)
  })

  it('throws when thinking used up max_tokens or the answer is empty', () => {
    expect(() =>
      parseClaudeMessage({ content: [{ type: 'thinking' }], stop_reason: 'max_tokens', usage: {} }),
    ).toThrow(/max_tokens/)
    expect(() =>
      parseClaudeMessage({
        content: [{ type: 'text', text: '  ' }],
        stop_reason: 'end_turn',
        usage: {},
      }),
    ).toThrow(ClaudeError)
  })
})

describe('error mapping', () => {
  const apiError = (status: number, text: string) =>
    Anthropic.APIError.generate(
      status,
      { type: 'error', error: { type: 'x', message: text } },
      text,
      new Headers(),
    )

  it.each([
    [401, 'invalid x-api-key'],
    [402, 'billing problem'],
    [400, 'Your credit balance is too low to access the Anthropic API'],
    [429, 'You have reached your workspace spend limit'],
  ])('maps %s to a quota pause', (status, text) => {
    const mapped = asClaudeQuotaError(apiError(status, text))
    expect(mapped).toBeInstanceOf(QuotaExhaustedError)
    expect((mapped as QuotaExhaustedError).status).toBe(status)
  })

  it('leaves plain rate limits, overload and bad requests as ordinary errors', () => {
    for (const [status, text] of [
      [429, 'rate limited'],
      [529, 'Overloaded'],
      [400, 'max_tokens must be positive'],
    ] as const) {
      const err = apiError(status, text)
      expect(asClaudeQuotaError(err)).toBe(err)
    }
    const other = new Error('boom')
    expect(asClaudeQuotaError(other)).toBe(other)
  })

  it('throws QuotaExhaustedError from generate on a 402 response without retrying', async () => {
    const { llm, calls } = client(() =>
      json({ type: 'error', error: { type: 'billing_error', message: 'billing' } }, 402),
    )
    await expect(llm.generate({ system: 's', user: 'u' })).rejects.toBeInstanceOf(
      QuotaExhaustedError,
    )
    expect(calls).toHaveLength(1)
  })
})

describe('llm selection', () => {
  it('requires the Claude key', () => {
    expect(() => createLlm({ model: 'claude-haiku-5-5', effort: 'medium' }, testLog)).toThrow(
      /CLAUDE_API_KEY/,
    )
  })

  it('sends the configured model and effort', async () => {
    const calls: Record<string, unknown>[] = []
    const fetchImpl = (async (_u: unknown, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body)))
      return json(message({ model: 'claude-sonnet-5-5' }))
    }) as unknown as typeof fetch
    vi.stubGlobal('fetch', fetchImpl)
    try {
      const llm = createLlm({ apiKey: 'k', model: 'claude-sonnet-5-5', effort: 'high' }, testLog)
      expect(llm).toMatchObject({ model: 'claude-sonnet-5-5', effort: 'high' })
      await llm.client.generate({ system: 's', user: 'u' })
    } finally {
      vi.unstubAllGlobals()
    }
    expect(calls[0]).toMatchObject({
      model: 'claude-sonnet-5-5',
      output_config: { effort: 'high' },
    })
  })
})
