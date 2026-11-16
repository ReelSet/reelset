import { describe, expect, it } from 'vitest'
import { STYLE_LIMITS } from '../src/pipeline/plain'
import { parseModelOutput } from '../src/pipeline/output'

const CHUNK = '11111111-1111-4111-8111-111111111111'
const validOutput = {
  tldr: 'A short summary.',
  topics: ['Queues', 'queues', 'Workers'],
  script: {
    version: 1,
    hook: 'Hook',
    beats: [
      { text: 'One', visual: { type: 'title', title: 'T' } },
      { text: 'Two', visual: { type: 'stat', label: 'L', value: '1' } },
    ],
    outro: 'Bye',
    claims: [{ text: 'Claim', chunkIds: [CHUNK] }],
  },
}

describe('parseModelOutput', () => {
  it('parses valid JSON and dedupes lowercase topics', () => {
    const result = parseModelOutput(JSON.stringify(validOutput))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.topics).toEqual(['queues', 'workers'])
  })
  it('strips markdown fences', () => {
    expect(parseModelOutput('```json\n' + JSON.stringify(validOutput) + '\n```').ok).toBe(true)
  })
  it('reports invalid JSON', () => {
    const result = parseModelOutput('Sure! Here is your script: {')
    expect(result).toEqual({ ok: false, reason: 'response was not valid JSON' })
  })
  it('reports schema mismatches with the failing paths', () => {
    const bad = {
      ...validOutput,
      script: { ...validOutput.script, beats: [validOutput.script.beats[0]] },
    }
    const result = parseModelOutput(JSON.stringify(bad))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('script.beats')
  })
  it('trims a tldr over 280 chars at a word boundary instead of rejecting it', () => {
    const result = parseModelOutput(JSON.stringify({ ...validOutput, tldr: 'word '.repeat(100) }))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.tldr.length).toBeLessThanOrEqual(280)
  })
  it('rejects non-uuid chunk ids', () => {
    const bad = {
      ...validOutput,
      script: { ...validOutput.script, claims: [{ text: 'c', chunkIds: ['chunk-1'] }] },
    }
    expect(parseModelOutput(JSON.stringify(bad)).ok).toBe(false)
  })
})

describe('hook options', () => {
  const withOptions = (hookOptions: unknown, extra: Record<string, unknown> = {}) =>
    JSON.stringify({
      tldr: 'Short.',
      topics: ['x'],
      script: {
        version: 1,
        hookOptions,
        hook: 'This is a new tool for developers.',
        headline: 'NEW TOOL',
        beats: [
          {
            text: "That matters if you're learning AI on a laptop. Cloud bills add up fast.",
            visual: { type: 'title', title: 'T' },
          },
          {
            text: 'Ollama shrinks the model to fit in 8 gigabytes. Then it runs offline.',
            visual: { type: 'title', title: 'T2' },
          },
        ],
        outro: 'No GPU, one command. Try it on your laptop.',
        claims: [{ text: 'c', chunkIds: ['11111111-1111-4111-8111-111111111111'] }],
        ...extra,
      },
    })
  const options = [
    { formula: 'The Reveal', spoken: 'This is a new tool for developers.', headline: 'NEW TOOL' },
    {
      formula: 'Permission',
      spoken: "You don't need a GPU to run this model.",
      headline: 'NO GPU NEEDED',
    },
    { formula: 'The Statistic', spoken: 'Let us talk about a model today.', headline: 'A MODEL' },
  ]

  it('keeps the strongest hook option with its headline and drops the options', () => {
    const r = parseModelOutput(withOptions(options))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.script.hook).toBe("You don't need a GPU to run this model.")
    expect(r.value.script.headline).toBe('NO GPU NEEDED')
    expect(r.value.script).not.toHaveProperty('hookOptions')
    expect(r.style.hookFormula).toBe('Permission')
    expect(r.style.hookScore).toBeGreaterThanOrEqual(70)
    expect(r.style.issues).toEqual([])
  })

  it('keeps the written hook when there are no options', () => {
    const r = parseModelOutput(withOptions(undefined))
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.script.hook).toBe('This is a new tool for developers.')
      expect(r.style.hookScore).toBeUndefined()
    }
  })

  it('reports style issues only when style limits are given', () => {
    const weak = [{ formula: 'The Reveal', spoken: 'This is something interesting for people.' }]
    const flat = { outro: 'Install it and see for yourself.' }
    expect(parseModelOutput(withOptions(weak, flat)).ok).toBe(true)
    const r = parseModelOutput(withOptions(weak, flat), undefined, '', {}, STYLE_LIMITS)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.style.issues[0]).toContain('the best hook')
    expect(r.style.issues.join(' ')).toContain('shares no word with the hook')
    expect(r.style.readingGrade).toBeGreaterThan(0)
  })

  it('swaps stock phrases in the narration before validating', () => {
    const r = parseModelOutput(
      withOptions(options, { outro: 'No GPU, and it is a game-changer for your laptop.' }),
    )
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.script.outro).toBe('No GPU, and it is a big deal for your laptop.')
  })
})

describe('reel length', () => {
  const sentence =
    'You can run this model on the laptop you already own, and it works offline too. '
  const long = (steps: string[]) =>
    JSON.stringify({
      ...validOutput,
      story: { idea: 'x', shape: 'Experiment', steps },
      script: {
        ...validOutput.script,
        beats: [0, 1, 2, 3, 4].map((i) => ({
          text: sentence.repeat(2).trim() + (i === 4 ? ' But it is slower.' : ''),
          visual: { type: 'title', title: 'T' },
        })),
      },
    })

  it('sends a long script back when the story has too few steps to need the room', () => {
    const r = parseModelOutput(long(['one', 'two']), undefined, '', {}, STYLE_LIMITS)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.style.issues.join(' ')).toContain('the story has 2 distinct steps')
      expect(r.style.words).toBeGreaterThan(125)
    }
  })

  it('lets a long script through when the story lists enough steps', () => {
    const r = parseModelOutput(
      long(['one', 'two', 'three', 'four']),
      undefined,
      '',
      {},
      STYLE_LIMITS,
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.style.issues.join(' ')).not.toContain('distinct steps')
      expect(r.style.storySteps).toBe(4)
    }
  })
})
