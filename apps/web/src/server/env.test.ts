import { afterEach, describe, expect, it, vi } from 'vitest'
import { askModelConfig } from './env'

describe('askModelConfig', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('pairs the admin-selected model with the env key', () => {
    vi.stubEnv('CLAUDE_API_KEY', 'sk-test')
    vi.stubEnv('ASK_MODEL', 'claude-haiku-5-5')
    expect(askModelConfig('claude-opus-5-5')).toEqual({
      apiKey: 'sk-test',
      model: 'claude-opus-5-5',
    })
  })

  it('fails loudly without the key', () => {
    vi.stubEnv('CLAUDE_API_KEY', '')
    expect(() => askModelConfig('claude-haiku-5-5')).toThrow(/CLAUDE_API_KEY/)
  })
})
