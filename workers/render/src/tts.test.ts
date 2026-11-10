import { describe, expect, it } from 'vitest'
import { RenderJobError } from './errors'
import {
  alignWords,
  chunkText,
  effectiveVoice,
  generateNarration,
  parseSpokenWords,
  selectProvider,
  shortenScript,
  speakableNumbers,
  fallbackEngineFor,
  type AiLike,
  type SpokenWord,
} from './tts'
import { silentLog } from './testing'

const spoken = (words: string[], step = 0.4): SpokenWord[] =>
  words.map((word, i) => ({ word, start: i * step, end: i * step + step }))

describe('alignWords', () => {
  it('never emits a word that ends before it starts when ASR words overlap', () => {
    const spoken: SpokenWord[] = [
      { word: 'a', start: 0, end: 1 },
      { word: 'b', start: 0.5, end: 0.8 },
      { word: 'c', start: 1, end: 2 },
    ]
    const out = alignWords('a b c', spoken, 2)
    for (const w of out.words) expect(w.end).toBeGreaterThanOrEqual(w.start)
  })

  it('uses ASR times directly for exact matches and keeps script tokens', () => {
    const out = alignWords('Hello brave new world', spoken(['hello', 'brave', 'new', 'world']), 1.6)
    expect(out.method).toBe('aligned')
    expect(out.words.map((w) => w.text)).toEqual(['Hello', 'brave', 'new', 'world'])
    expect(out.words[2]!.start).toBeCloseTo(0.8)
    expect(out.words[2]!.end).toBeCloseTo(1.2)
  })

  it('ignores punctuation and case when matching', () => {
    const out = alignWords('Wait, what? Yes!', spoken(['wait', 'what', 'yes']), 1.2)
    expect(out.matched).toBe(3)
    expect(out.words.map((w) => w.text)).toEqual(['Wait,', 'what?', 'Yes!'])
  })

  it('maps a number read aloud onto its token window', () => {
    const heard = spoken(['it', 'takes', 'three', 'point', 'five', 'seconds'], 0.5)
    const out = alignWords('It takes 3.5 seconds', heard, 3)
    expect(out.method).toBe('aligned')
    const num = out.words[2]!
    expect(num.text).toBe('3.5')
    expect(num.start).toBe(1)
    expect(num.end).toBe(2.5)
    expect(out.words[3]).toMatchObject({ text: 'seconds', start: 2.5, end: 3 })
  })

  it('splits a gap by character weight when several tokens share unmatched speech', () => {
    const heard = spoken(['we', 'ship', 'it'], 1)
    const out = alignWords('We ship v2 beta it', heard, 3)
    const [v2, beta] = [out.words[2]!, out.words[3]!]
    expect(v2.start).toBe(2)
    expect(v2.end).toBeCloseTo(beta.start)
    expect(beta.end).toBeLessThanOrEqual(2 + 1e-9)
  })

  it('gives words the ASR dropped a slot between their neighbours', () => {
    const heard: SpokenWord[] = [
      { word: 'one', start: 0, end: 0.5 },
      { word: 'three', start: 1.5, end: 2 },
    ]
    const out = alignWords('one two three', heard, 2)
    expect(out.words[1]).toMatchObject({ text: 'two', start: 0.5, end: 1.5 })
  })

  it('keeps times monotonic', () => {
    const out = alignWords('a b, c d e f', spoken(['a', 'x', 'c', 'e', 'f']), 2)
    for (let i = 1; i < out.words.length; i++) {
      expect(out.words[i]!.start).toBeGreaterThanOrEqual(out.words[i - 1]!.end - 1e-9)
      expect(out.words[i]!.end).toBeGreaterThanOrEqual(out.words[i]!.start)
    }
  })

  it('falls back to per-character timing when almost nothing matches', () => {
    const out = alignWords('alpha beta gamma delta', spoken(['x', 'y', 'z']), 3)
    expect(out.method).toBe('proportional')
    expect(out.words).toHaveLength(4)
    expect(out.words.at(-1)!.end).toBeCloseTo(1.2)
    expect(out.words[0]!.end - out.words[0]!.start).toBeGreaterThan(
      out.words[1]!.end - out.words[1]!.start,
    )
  })

  it('spans the whole audio when the ASR returned nothing', () => {
    const out = alignWords('one two', [], 4)
    expect(out.method).toBe('proportional')
    expect(out.words[0]!.start).toBe(0)
    expect(out.words.at(-1)!.end).toBeCloseTo(4)
  })

  it('returns no words for empty text', () => {
    expect(alignWords('  ', spoken(['a']), 1).words).toEqual([])
  })
})

describe('chunkText', () => {
  it('keeps short text in one chunk', () => {
    expect(chunkText('One. Two! Three?', 100)).toEqual(['One. Two! Three?'])
  })

  it('packs whole sentences up to the limit', () => {
    const chunks = chunkText('Aaaa aaaa. Bbbb bbbb. Cccc cccc.', 22)
    expect(chunks).toEqual(['Aaaa aaaa. Bbbb bbbb.', 'Cccc cccc.'])
  })

  it('splits an overlong sentence on word boundaries', () => {
    const chunks = chunkText('word '.repeat(30).trim() + '.', 40)
    expect(chunks.length).toBeGreaterThan(3)
    expect(chunks.every((c) => c.length <= 40)).toBe(true)
    expect(chunks.join(' ').split(' ')).toHaveLength(30)
  })

  it('returns nothing for blank text', () => {
    expect(chunkText('   ')).toEqual([])
  })
})

describe('provider selection', () => {
  const ai: AiLike = { run: async () => null }

  it('keeps edge and kokoro, and starts aura2 at kokoro without a binding', () => {
    expect(selectProvider('edge', ai)).toBe('edge')
    expect(selectProvider('kokoro', undefined)).toBe('kokoro')
    expect(selectProvider('aura2', ai)).toBe('aura2')
    expect(selectProvider('aura2', undefined)).toBe('kokoro')
  })

  it('changes the render-key voice per provider and speaker', () => {
    const edge = effectiveVoice('edge', 'hera', 'en-US-AriaNeural')
    expect(edge).toBe('en-US-AriaNeural')
    expect(effectiveVoice('aura2', 'hera', edge)).toBe('aura2-hera')
    expect(effectiveVoice('aura2', 'orion', edge)).not.toBe('aura2-hera')
    expect(effectiveVoice('kokoro', 'hera', edge)).toBe('kokoro-af_heart')
  })

  it('uses kokoro as the container engine unless edge was chosen explicitly', () => {
    expect(fallbackEngineFor('aura2')).toBe('kokoro')
    expect(fallbackEngineFor('kokoro')).toBe('kokoro')
    expect(fallbackEngineFor('edge')).toBe('edge')
  })
})

describe('generateNarration', () => {
  const transcript = {
    results: {
      channels: [
        {
          alternatives: [
            {
              words: [
                { word: 'hi', start: 0, end: 0.4 },
                { word: 'there', start: 0.4, end: 1 },
              ],
            },
          ],
        },
      ],
    },
  }

  it('chains aura and nova, aligns, and prices by characters plus audio minutes', async () => {
    const calls: string[] = []
    const ai: AiLike = {
      async run(model, input) {
        calls.push(model)
        if (model.includes('aura')) {
          expect(input).toMatchObject({ speaker: 'hera', encoding: 'mp3' })
          return new Uint8Array([1, 2, 3])
        }
        return transcript
      },
    }
    const out = await generateNarration(ai, 'Hi there', 'hera', silentLog)
    expect(calls).toEqual(['@cf/deepgram/aura-2-en', '@cf/deepgram/nova-3'])
    expect(out.words.map((w) => w.text)).toEqual(['Hi', 'there'])
    expect(out.chars).toBe(8)
    expect(out.costUsd).toBeCloseTo(8 * 0.00003 + (1 / 60) * 0.0052, 6)
  })

  it('rejects unusable alignment so the caller falls back', async () => {
    const ai: AiLike = {
      async run(model) {
        if (model.includes('aura')) return new Uint8Array([1])
        return { results: { channels: [{ alternatives: [{ words: [] }] }] } }
      },
    }
    await expect(generateNarration(ai, 'Hi there', 'hera', silentLog)).rejects.toMatchObject({
      code: 'tts_unavailable',
    })
  })

  it('maps workers ai failures to a retryable tts_unavailable error', async () => {
    const ai: AiLike = {
      async run() {
        throw new Error('5xx')
      },
    }
    await expect(generateNarration(ai, 'Hi', 'hera', silentLog)).rejects.toMatchObject({
      code: 'tts_unavailable',
    })
    await expect(generateNarration(ai, 'Hi', 'hera', silentLog)).rejects.toBeInstanceOf(
      RenderJobError,
    )
  })
})

describe('parseSpokenWords', () => {
  it('ignores malformed entries', () => {
    expect(parseSpokenWords({})).toEqual([])
    const parsed = parseSpokenWords({
      results: {
        channels: [{ alternatives: [{ words: [{ word: 'a', start: 0, end: 1 }, { x: 1 }] }] }],
      },
    })
    expect(parsed).toEqual([{ word: 'a', start: 0, end: 1 }])
  })
})

describe('shortenScript', () => {
  const base = {
    version: 1 as const,
    hook: 'Hook line.',
    beats: [
      {
        text: 'One a b c. Two d e f. Three g h i.',
        visual: { type: 'title' as const, title: 'A' },
        shots: [
          { at: 'one', show: 'KeyPoint' as const },
          { at: 'three', show: 'KeyPoint' as const },
        ],
      },
      { text: 'Solo sentence only.', visual: { type: 'title' as const, title: 'B' } },
    ],
    outro: 'Outro line.',
    claims: [],
  }

  it('drops trailing sentences from the longest beat, keeping hook, outro and one sentence per beat', () => {
    const out = shortenScript(base, 0.7)!
    expect(out.hook).toBe(base.hook)
    expect(out.outro).toBe(base.outro)
    expect(out.beats[1]!.text).toBe('Solo sentence only.')
    expect(out.beats[0]!.text.startsWith('One a b c.')).toBe(true)
    expect(out.beats[0]!.text).not.toContain('Three')
  })

  it('removes shots whose cue word was cut', () => {
    const out = shortenScript(base, 0.7)!
    expect(out.beats[0]!.shots?.map((s) => s.at)).toEqual(['one'])
  })

  it('returns null when every beat is a single sentence', () => {
    expect(shortenScript({ ...base, beats: [base.beats[1]!, base.beats[1]!] }, 0.5)).toBeNull()
  })
})

describe('speakableNumbers', () => {
  const script = {
    version: 1 as const,
    hook: 'Billing gets 0.9982666969299316 here.',
    beats: [
      {
        text: 'Technical gets 0.0010246571619063616 and sales 0.0007087149424478412. Pi is 3.14.',
        visual: { type: 'title' as const, title: 'A' },
        shots: [{ at: '0.0010246571619063616', show: 'KeyPoint' as const }],
      },
    ],
    outro: 'Done.',
    claims: [],
  }

  it('rounds long decimals to 3 significant digits and leaves short numbers alone', () => {
    const out = speakableNumbers(script)
    expect(out.hook).toBe('Billing gets 0.998 here.')
    expect(out.beats[0]!.text).toBe('Technical gets 0.00102 and sales 0.000709. Pi is 3.14.')
  })

  it('keeps a shot cue pointing at the rewritten word', () => {
    expect(speakableNumbers(script).beats[0]!.shots![0]!.at).toBe('0.00102')
  })
})

describe('shortenScript whole-beat cuts', () => {
  const beat = (n: number) => ({
    text: `Beat ${n} has some words in it.`,
    visual: { type: 'title' as const, title: `T${n}` },
  })
  const script = {
    version: 1 as const,
    hook: 'Hook line.',
    beats: [beat(1), beat(2), beat(3), beat(4), beat(5)],
    outro: 'Outro line.',
    claims: [],
  }

  it('drops whole beats when every beat is a single sentence, never the first, never below 3', () => {
    const out = shortenScript(script, 0.3)!
    expect(out.beats.length).toBe(3)
    expect(out.beats[0]!.text).toContain('Beat 1')
  })

  it('returns null when only 3 single-sentence beats remain', () => {
    expect(shortenScript({ ...script, beats: script.beats.slice(0, 3) }, 0.5)).toBeNull()
  })
})
