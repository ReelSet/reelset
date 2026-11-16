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
  it('posts the segments with the bearer token and returns audio with one word per token', async () => {
    const cfg = config(Response.json(okBody))
    const out = await generateChatterbox(cfg, script, silentLog)
    const [url, init] = cfg.fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://tts.test/synthesize')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer secret')
    expect(JSON.parse(init.body as string)).toEqual({
      segments: ['Two words.', 'First beat here.', 'Bye.'],
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
