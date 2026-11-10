import { describe, expect, it } from 'vitest'
import { parseModelOutput } from '../src/pipeline/gemini'
import { SYSTEM_PROMPT, STYLE_GUIDE } from '../src/pipeline/prompt'
import { readableKeyPoint, repairShots } from '../src/pipeline/shots'

const CHUNK = '11111111-1111-4111-8111-111111111111'
const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ')
const script = (beatWords: number, extra: Record<string, unknown> = {}) => ({
  tldr: 'Short.',
  topics: ['x'],
  script: {
    version: 1,
    hook: 'Hook is five words long.',
    beats: [
      { text: words(beatWords), visual: { type: 'title', title: 'T' }, ...extra },
      { text: words(beatWords), visual: { type: 'title', title: 'T2' } },
    ],
    outro: 'Outro is here now.',
    claims: [{ text: 'c', chunkIds: [CHUNK] }],
  },
})

describe('hook engineering rules in the prompt', () => {
  it('bans weak openers, asks for three drafted hooks and a number-led headline', () => {
    for (const phrase of ['In this video', 'Have you ever', "Let's talk about"]) {
      expect(SYSTEM_PROMPT).toContain(phrase)
    }
    expect(SYSTEM_PROMPT).toContain('Draft three different hooks')
    expect(SYSTEM_PROMPT).toContain('must agree with the hook')
    expect(SYSTEM_PROMPT).toContain('sentence case of 3 to 8 words')
    expect(SYSTEM_PROMPT).toContain(STYLE_GUIDE)
  })

  it('has no provider-specific wording', () => {
    expect(SYSTEM_PROMPT).not.toMatch(/gemini|claude|anthropic|openai/i)
  })
})

describe('narration word window', () => {
  it('rejects scripts outside the configured window with an instruction', () => {
    const short = parseModelOutput(JSON.stringify(script(10)), undefined, '', {
      min: 110,
      max: 125,
    })
    expect(short.ok).toBe(false)
    if (!short.ok) expect(short.reason).toMatch(/under 110/)
    const long = parseModelOutput(JSON.stringify(script(50)), undefined, '', { min: 10, max: 60 })
    expect(long.ok).toBe(false)
    if (!long.ok) expect(long.reason).toMatch(/over 60/)
    expect(
      parseModelOutput(JSON.stringify(script(55)), undefined, '', { min: 110, max: 125 }).ok,
    ).toBe(true)
  })

  it('keeps valid beat keyPoints through the schema', () => {
    const ok = parseModelOutput(
      JSON.stringify(script(5, { keyPoints: ['One DNS record fixes it'] })),
    )
    expect(ok.ok).toBe(true)
    if (ok.ok) expect(ok.value.script.beats[0]!.keyPoints).toEqual(['One DNS record fixes it'])
  })
})

describe('readableKeyPoint', () => {
  const narration = 'P2-MOPD treats a linear combination of parameters as one model.'
  it('accepts a sentence-case statement that adds something', () => {
    expect(readableKeyPoint('Same quality, half the steps', narration)).toBe(
      'Same quality, half the steps',
    )
    expect(readableKeyPoint('One DNS record fixes it.', 'Mail is bouncing right now.')).toBe(
      'One DNS record fixes it',
    )
  })

  it('rejects fragments, restatements, bad length, lowercase and title case', () => {
    expect(readableKeyPoint('linear combination', narration)).toBeNull()
    expect(readableKeyPoint('Linear parameter combination', narration)).toBeNull()
    expect(readableKeyPoint('Treats parameters as one model', narration)).toBeNull()
    expect(readableKeyPoint('Too short', narration)).toBeNull()
    expect(readableKeyPoint('One two three four five six seven eight nine', narration)).toBeNull()
    expect(readableKeyPoint('same quality, half the steps', narration)).toBeNull()
    expect(readableKeyPoint('Faster Training For Everyone', narration)).toBeNull()
    expect(readableKeyPoint('Recovery rises to the', narration)).toBeNull()
    expect(readableKeyPoint(42, narration)).toBeNull()
  })

  it('allows capitalised names the narration already uses', () => {
    expect(
      readableKeyPoint('Fizgig beats OneTrainer on speed', 'Fizgig and OneTrainer train LoRAs.'),
    ).toBe('Fizgig beats OneTrainer on speed')
  })
})

describe('repairShots with keyPoint candidates', () => {
  const facts = new Set([20, 49])
  const beat = (shots: unknown[], keyPoints?: unknown[]) => ({
    text: 'Training on an RTX 5090 now takes 20 minutes instead of 49.',
    shots,
    ...(keyPoints ? { keyPoints } : {}),
  })

  it('keeps a readable model statement as is', () => {
    const b = beat([
      { cue: 'minutes', show: 'KeyPoint', props: { text: 'Same results, a third of the time' } },
    ])
    repairShots(b as never, facts)
    expect((b.shots as { props: { text: string } }[])[0]!.props.text).toBe(
      'Same results, a third of the time',
    )
  })

  it('swaps a keyword extract for the beat candidate', () => {
    const b = beat(
      [{ cue: 'RTX', show: 'KeyPoint', props: { text: 'RTX' } }],
      ['Mid-range GPUs now train this fast'],
    )
    repairShots(b as never, facts)
    expect((b.shots as { props: { text: string } }[])[0]!.props.text).toBe(
      'Mid-range GPUs now train this fast',
    )
  })

  it('drops ungrounded, literal or malformed candidates from the beat', () => {
    const b = beat(
      [],
      [
        'Now 77 minutes faster overall',
        'Training takes 20 minutes',
        'Hi',
        'A real new insight here',
      ],
    )
    repairShots(b as never, facts)
    expect(b.keyPoints).toEqual(['A real new insight here'])
    const none = beat([], ['no'])
    repairShots(none as never, facts)
    expect(none).not.toHaveProperty('keyPoints')
  })
})

describe('repairShots show normalisation', () => {
  it('accepts a show written as an object with a type', () => {
    const b = {
      text: 'The weakest domain stops lagging behind after training.',
      shots: [
        { cue: 'weakest', show: { type: 'KeyPoint' }, props: { text: 'Nothing gets left behind' } },
      ],
    }
    repairShots(b as never, new Set())
    expect((b.shots as unknown as { show: string }[])[0]!.show).toBe('KeyPoint')
  })
})

describe('stat values keep their sign', () => {
  it('restores a minus the narration states', () => {
    const b = {
      text: 'Its worst-domain recovery hit -261.18 on the small model.',
      shots: [
        { cue: 'worst-domain', show: 'StatSlam', props: { value: '261.18', label: 'recovery' } },
      ],
    }
    repairShots(b as never, new Set([261.18]))
    const props = (b.shots as unknown as { props: { value: string } }[])[0]!.props
    expect(props.value).toBe('-261.18')
  })
})
