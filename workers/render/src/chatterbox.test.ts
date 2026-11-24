import type { ReelScript } from '@reelset/core'
import { describe, expect, it, vi } from 'vitest'
import { chatterboxSegments, generateChatterbox } from './chatterbox'
import { silentLog } from './testing'
import { effectiveVoice, fallbackEngineFor, selectProvider } from './tts'

const script = {
  hook: 'Two words.',
  beats: [{ text: 'First beat here.' }, { text: '  ' }],
  outro: 'Bye.',
} as unknown as ReelScript

const words = ['Two', 'words.', 'First', 'beat', 'here.', 'Bye.'].map((text, i) => ({
  text,
  start: i * 0.5,
  end: i * 0.5 + 0.4,
}))

const okBody = { audioBase64: btoa('mp3'), words, audioSeconds: 3.2, synthSeconds: 2 }

const config = (response: Response | Error) => ({
  url: 'https://tts.test/synthesize',
  token: 'secret',
  voice: 'genz' as const,
  fetch: vi.fn(async () => {
    if (response instanceof Error) throw response
    return response
  }),
})

describe('chatterboxSegments', () => {
  it('sends hook, beats and outro as separate segments and drops empty ones', () => {
    expect(chatterboxSegments(script)).toEqual(['Two words.', 'First beat here.', 'Bye.'])
  })
})

describe('generateChatterbox', () => {
  it('posts the segments and narrator voice with the bearer token and returns audio with one word per token', async () => {
    const cfg = config(Response.json(okBody))
    const out = await generateChatterbox(cfg, script, silentLog)
    const [url, init] = cfg.fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://tts.test/synthesize')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer secret')
    expect(JSON.parse(init.body as string)).toEqual({
      segments: ['Two words.', 'First beat here.', 'Bye.'],
      voice: 'genz',
    })
    expect(new TextDecoder().decode(out.audio)).toBe('mp3')
    expect(out.words).toHaveLength(6)
    expect(out.audioSeconds).toBe(3.2)
    expect(out.costUsd).toBe(0)
  })

  it('never lets a word start before the previous one', async () => {
    const jumbled = words.map((w, i) => (i === 2 ? { ...w, start: 0.1, end: 0.2 } : w))
    const out = await generateChatterbox(
      config(Response.json({ ...okBody, words: jumbled })),
      script,
      silentLog,
    )
    for (let i = 1; i < out.words.length; i++) {
      expect(out.words[i]!.start).toBeGreaterThanOrEqual(out.words[i - 1]!.start)
      expect(out.words[i]!.end).toBeGreaterThanOrEqual(out.words[i]!.start)
    }
  })

  it.each([
    ['a network error', new Error('boom')],
    ['a bad status', new Response('no', { status: 500 })],
    ['a body that is not json', new Response('oops')],
    ['missing audio', Response.json({ ...okBody, audioBase64: '' })],
    [
      'a word count that does not match the script',
      Response.json({ ...okBody, words: words.slice(1) }),
    ],
    ['a malformed word', Response.json({ ...okBody, words: [{ text: 'x' }] })],
  ])('throws tts_unavailable on %s', async (_name, response) => {
    await expect(generateChatterbox(config(response), script, silentLog)).rejects.toMatchObject({
      code: 'tts_unavailable',
    })
  })
})

describe('qwen through the modal client', () => {
  it('logs as qwen and takes the gpu cost the service reports', async () => {
    const cfg = {
      ...config(Response.json({ ...okBody, gpu: 'L4', gpuSeconds: 35, gpuUsd: 0.00777 })),
      engine: 'qwen' as const,
    }
    const out = await generateChatterbox(cfg, script, silentLog)
    expect(out.costUsd).toBe(0.00777)
    expect(out.words).toHaveLength(6)
  })

  it('names qwen in the error so the fallback log shows which engine failed', async () => {
    const cfg = { ...config(new Response('no', { status: 503 })), engine: 'qwen' as const }
    await expect(generateChatterbox(cfg, script, silentLog)).rejects.toMatchObject({
      code: 'tts_unavailable',
      message: 'qwen tts failed: bad_status',
    })
  })

  it('ignores a missing or nonsense gpu cost', async () => {
    const out = await generateChatterbox(
      config(Response.json({ ...okBody, gpuUsd: -1 })),
      script,
      silentLog,
    )
    expect(out.costUsd).toBe(0)
  })
})

describe('qwen provider selection', () => {
  it('starts at qwen only when its url and the token are set', () => {
    expect(selectProvider('qwen', undefined, true, true)).toBe('qwen')
    expect(selectProvider('qwen', undefined, true, false)).toBe('chatterbox')
    expect(selectProvider('qwen', undefined, false, false)).toBe('kokoro')
  })

  it('keys renders by its own voice and keeps kokoro as the container fallback', () => {
    expect(effectiveVoice('qwen', 'hera', 'en-US-AriaNeural')).toBe('qwen-genz')
    expect(fallbackEngineFor('qwen')).toBe('kokoro')
  })
})

describe('chatterbox provider selection', () => {
  it('starts at kokoro when the service is not configured', () => {
    expect(selectProvider('chatterbox', undefined, false)).toBe('kokoro')
    expect(selectProvider('chatterbox', undefined, true)).toBe('chatterbox')
  })

  it('falls back to kokoro in the container and has its own render-key voice', () => {
    expect(fallbackEngineFor('chatterbox')).toBe('kokoro')
    expect(effectiveVoice('chatterbox', 'hera', 'en-US-AriaNeural')).toBe('chatterbox-nano')
  })
})
