import { describe, expect, it } from 'vitest'
import { scrubbedEnv } from './child'
import { parseDirectorConfig } from './config'

const valid = {
  model: 'claude-haiku-5-5',
  effort: 'medium',
  maxTokens: 128000,
  review: true,
  rules: 'rules',
  reviewPrompt: 'review',
  skills: [{ name: 'motion', content: 'x' }, { name: 3 }, null],
  example: null,
}

describe('parseDirectorConfig', () => {
  it('accepts the contract shape and drops malformed skills', () => {
    expect(parseDirectorConfig(valid)).toEqual({
      ...valid,
      skills: [{ name: 'motion', content: 'x' }],
    })
  })

  it('rejects bad types and unknown efforts', () => {
    expect(parseDirectorConfig(null)).toBeNull()
    expect(parseDirectorConfig([])).toBeNull()
    expect(parseDirectorConfig({ ...valid, effort: 'ludicrous' })).toBeNull()
    expect(parseDirectorConfig({ ...valid, model: '' })).toBeNull()
    expect(parseDirectorConfig({ ...valid, maxTokens: 1.5 })).toBeNull()
    expect(parseDirectorConfig({ ...valid, rules: 4 })).toBeNull()
  })
})

describe('scrubbedEnv', () => {
  it('keeps only what Node and ffmpeg need and never a secret', () => {
    const env = scrubbedEnv({
      PATH: '/usr/bin',
      LANG: 'C.UTF-8',
      TMPDIR: '/tmp',
      HOME: '/home/reel',
      BOX_TOKEN: 'secret',
      CLAUDE_API_KEY: 'sk-ant',
      INSTAGRAM_PASSWORD: 'pw',
      SKIA_ASSETS: '/app/skia/assets',
    })
    expect(env).toEqual({
      HOME: '/tmp',
      PATH: '/usr/bin',
      LANG: 'C.UTF-8',
      TMPDIR: '/tmp',
      SKIA_ASSETS: '/app/skia/assets',
    })
  })
})
