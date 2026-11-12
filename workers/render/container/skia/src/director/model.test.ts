import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DirectorConfig } from './config'

const stream = vi.fn()
const ctor = vi.fn()
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { stream }
    constructor(opts: unknown) {
      ctor(opts)
    }
  },
}))

const config: DirectorConfig = {
  model: 'claude-haiku-5-5',
  effort: 'high',
  maxTokens: 4096,
  review: false,
  rules: '',
  reviewPrompt: '',
  skills: [],
  example: null,
}

describe('createAskModel', () => {
  beforeEach(() => {
    stream.mockReset()
    ctor.mockReset()
  })

  it('streams with the configured model, effort and a cached system block, and maps usage', async () => {
    stream.mockReturnValue({
      finalMessage: async () => ({
        stop_reason: 'end_turn',
        content: [{ type: 'thinking' }, { type: 'text', text: 'hello' }],
        usage: {
          input_tokens: 3,
          output_tokens: 9,
          cache_read_input_tokens: null,
          cache_creation_input_tokens: 11,
        },
      }),
    })
    const { createAskModel } = await import('./model')
    const reply = await createAskModel('sk-test', config)('SYSTEM', [
      { role: 'user', content: 'hi' },
    ])
    expect(ctor).toHaveBeenCalledWith({ apiKey: 'sk-test' })
    const [params] = stream.mock.calls[0]!
    expect(params).toMatchObject({
      model: 'claude-haiku-5-5',
      max_tokens: 4096,
      output_config: { effort: 'high' },
      system: [{ type: 'text', text: 'SYSTEM', cache_control: { type: 'ephemeral' } }],
    })
    expect(reply).toEqual({
      text: 'hello',
      stopReason: 'end_turn',
      usage: { inputTokens: 3, outputTokens: 9, cacheReadTokens: 0, cacheWriteTokens: 11 },
    })
  })
})
