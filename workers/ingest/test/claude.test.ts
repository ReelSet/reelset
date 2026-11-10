import { describe, expect, it, vi } from 'vitest'
import Anthropic from '@anthropic-ai/sdk'
import {
  ClaudeError,
  ClaudeRefusalError,
  asClaudeQuotaError,
  claudeCostUsd,
  createClaudeClient,
  parseClaudeMessage,
} from '../src/pipeline/claude'
import { createLlm, llmCostFor, parseLlmProvider } from '../src/pipeline/llm'
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

describe('cost', () => {
  it('uses the small rate card at or under 100K prompt tokens', () => {
    expect(claudeCostUsd({ inputTokens: 1_000_000 / 100, outputTokens: 0 })).toBeCloseTo(0.001)
    expect(claudeCostUsd({ inputTokens: 0, outputTokens: 1_000_000 })).toBeCloseTo(0.5)
  })

  it('prices cache reads at 0.1x and cache writes at 1.25x of the input rate', () => {
    expect(
      claudeCostUsd({
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 100_000,
        cacheWriteTokens: 0,
      }),
    ).toBeCloseTo(0.001)
    expect(
      claudeCostUsd({
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 100_000,
      }),
    ).toBeCloseTo(0.0125)
  })

  it('switches to the large rate card above 100K prompt tokens', () => {
    expect(claudeCostUsd({ inputTokens: 200_000, outputTokens: 1_000_000 })).toBeCloseTo(0.1 + 2.5)
  })

  it('routes provider costs', () => {
    const usage = { inputTokens: 100_000, outputTokens: 100_000 }
    expect(llmCostFor('anthropic', usage)).toBeCloseTo(0.01 + 0.05)
    expect(llmCostFor('gemini', usage)).toBeCloseTo(0.175)
  })
})

describe('provider selection', () => {
  it('defaults to gemini and rejects unknown providers', () => {
    expect(parseLlmProvider(undefined)).toBe('gemini')
    expect(parseLlmProvider('anthropic')).toBe('anthropic')
    expect(() => parseLlmProvider('openai')).toThrow(/LLM_PROVIDER/)
  })

  it('requires the matching key and picks the model', () => {
    expect(() => createLlm({ LLM_PROVIDER: 'anthropic' }, testLog)).toThrow(/CLAUDE_API_KEY/)
    expect(createLlm({ LLM_PROVIDER: 'anthropic', CLAUDE_API_KEY: 'k' }, testLog).model).toBe(
      'claude-haiku-5-5',
    )
    const gemini = createLlm({ GEMINI_API_KEY: 'k', GEMINI_MODEL: 'gemini-x' }, testLog)
    expect(gemini.provider).toBe('gemini')
    expect(gemini.model).toBe('gemini-x')
    expect(createLlm({ GEMINI_API_KEY: 'k', LLM_MODEL: 'm' }, testLog).model).toBe('m')
  })
})
