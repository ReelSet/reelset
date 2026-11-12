import { describe, expect, it } from 'vitest'
import { SCREEN_NAMES, SFX_NAMES } from '@reelset/core'
import { readFileSync } from 'node:fs'
import { parseModelOutput } from '../src/pipeline/output'
import { PROMPT_VERSION, SYSTEM_PROMPT } from '../src/pipeline/prompt'
import {
  clipHeadline,
  cueExists,
  narrationWordCount,
  numberValues,
  repairShots,
} from '../src/pipeline/shots'

const CHUNK = '11111111-1111-4111-8111-111111111111'
const FACTS =
  'unslop has 1,240 stars, version 2.3.0 and runs with npx unslop@latest audit. Scores 87.5%.'

function output(beats: unknown[], extra: Record<string, unknown> = {}) {
  return {
    tldr: 'Summary.',
    topics: ['ai'],
    script: {
      version: 1,
      hook: 'Hook line',
      headline: 'Stop shipping AI slop forever and ever today',
      beats,
      outro: 'Bye',
      claims: [{ text: 'Claim', chunkIds: [CHUNK] }],
      ...extra,
    },
  }
}

const parse = (o: unknown) => parseModelOutput(JSON.stringify(o), new Set([CHUNK]), FACTS)

describe('number grounding', () => {
  it('treats 1,240 / 1240 / 1.24k as comparable values', () => {
    expect(numberValues('1,240 and 1240')).toEqual(new Set([1240]))
    expect([...numberValues('about 1.2k stars')]).toEqual([1200])
    expect(numberValues('v2.3.0 and 87.5%').has(87.5)).toBe(true)
  })
})

describe('cue words', () => {
  it('finds a word, ignoring case and punctuation, and the nth repeat', () => {
    const text = 'It finds Slop, then more slop.'
    expect(cueExists('slop', text)).toBe(true)
    expect(cueExists('slop#2', text)).toBe(true)
    expect(cueExists('slop#3', text)).toBe(false)
    expect(cueExists('missing', text)).toBe(false)
    expect(cueExists('two words', text)).toBe(false)
  })
})

describe('headline', () => {
  it('keeps at most 7 words', () => {
    expect(clipHeadline('Stop shipping AI slop forever and ever today.')).toBe(
      'Stop shipping AI slop forever and ever',
    )
    expect(clipHeadline('  ')).toBeUndefined()
  })
})

describe('shot repair', () => {
  const beat = (shots: unknown[]) => ({ text: 'It has 1,240 stars and a clean audit.', shots })

  it('drops shots whose cue word is not in the beat text', () => {
    const b = beat([
      { at: 'stars', show: 'RepoPage', props: { name: 'unslop' } },
      { at: 'nothing', show: 'KeyPoint', props: { title: 'x' } },
    ])
    repairShots(b, numberValues(FACTS))
    expect((b.shots as unknown[]).length).toBe(1)
  })

  it('drops invented numbers but keeps grounded ones', () => {
    const b = beat([
      { at: 'stars', show: 'StatSlam', props: { value: '1,240', label: 'stars' } },
      { at: 'clean', show: 'StatSlam', props: { value: 99999 } },
      { at: 'audit', show: 'RepoPage', props: { name: 'unslop', stars: 5000 } },
    ])
    repairShots(b, numberValues(FACTS))
    const shots = b.shots as { at: string; props?: Record<string, unknown> }[]
    expect(shots.map((s) => s.at)).toEqual(['stars', 'audit'])
    expect(shots[1]?.props).toEqual({ name: 'unslop' })
  })

  it('rejects unknown screens, unknown sfx and caps the count', () => {
    const b = beat([
      { at: 'stars', show: 'hologram' },
      { at: 'has', show: 'RepoPage', sfx: 'boom' },
      ...['has', 'stars', 'clean', 'audit', '1,240'].map((at) => ({ at, show: 'KeyPoint' })),
    ])
    repairShots(b, new Set())
    const shots = b.shots as { show: string; sfx?: string }[]
    expect(shots).toHaveLength(4)
    expect(shots[0]).toEqual({ at: 'has', show: 'RepoPage' })
  })

  it('reads the "cue" field and drops filler-word cues', () => {
    const b = beat([
      { cue: 'and', show: 'KeyPoint' },
      { cue: 'a', show: 'KeyPoint' },
      { cue: 'stars', show: 'RepoPage' },
    ])
    repairShots(b, new Set())
    expect(b.shots).toEqual([{ at: 'stars', show: 'RepoPage' }])
  })

  it('removes empty shots arrays', () => {
    const b = beat([{ at: 'zzz', show: 'RepoPage' }])
    repairShots(b, new Set())
    expect('shots' in b).toBe(false)
  })
})

describe('parseModelOutput with shots', () => {
  const beats = [
    {
      text: 'Unslop has 1,240 stars today.',
      visual: { type: 'title', title: 'T' },
      shots: [
        { at: 'stars', show: 'StatSlam', props: { value: '1,240', label: 'stars' }, sfx: 'ding' },
        { at: 'today', show: 'StatSlam', props: { value: '9,999', label: 'users' } },
      ],
    },
    { text: 'Run it now.', visual: { type: 'stat', label: 'L', value: '1' } },
  ]

  it('clips the headline and keeps only grounded shots', () => {
    const r = parse(output(beats))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.script.headline).toBe('Stop shipping AI slop forever and ever')
    expect(r.value.script.beats[0]?.shots).toHaveLength(1)
    expect(r.value.script.beats[0]?.shots?.[0]?.sfx).toBe('ding')
  })

  it('still accepts scripts with no headline or shots', () => {
    const r = parse(
      output([{ text: 'One', visual: { type: 'title', title: 'T' } }, beats[1]], {
        headline: undefined,
      }),
    )
    expect(r.ok).toBe(true)
  })

  it('rejects narration over the length cap so the model retries', () => {
    const long = Array.from({ length: 4 }, () => ({
      text: 'word '.repeat(45).trim(),
      visual: { type: 'title', title: 'T' },
    }))
    const r = parse(output(long))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('words')
    expect(narrationWordCount({ hook: 'a b', beats: [{ text: 'c d e' }], outro: 'f' })).toBe(6)
  })
})

describe('prompt', () => {
  it('is versioned and lists every screen and sfx the renderer knows', () => {
    expect(PROMPT_VERSION).toBe('reel-v8')
    expect(SYSTEM_PROMPT).toContain('Never mention popularity counts')
    for (const name of SCREEN_NAMES) expect(SYSTEM_PROMPT).toContain(`${name}:`)
    for (const name of SFX_NAMES) expect(SYSTEM_PROMPT).toContain(name)
    expect(SYSTEM_PROMPT).toContain('100 to 112 words')
    expect(SYSTEM_PROMPT).toContain('at most 760 characters')
    expect(SYSTEM_PROMPT).toContain('at most 3 significant digits')
  })

  it('matches the renderer enum lists in the planner types', () => {
    const types = readFileSync(
      new URL('../../render/container/skia/src/planner/lib/types.ts', import.meta.url),
      'utf8',
    )
    const grab = (name: string) =>
      [
        ...(new RegExp(`${name} = \\[([^\\]]+)\\]`).exec(types)?.[1] ?? '').matchAll(/'(\w+)'/g),
      ].map((m) => m[1])
    expect(grab('SCREEN_NAMES')).toEqual([...SCREEN_NAMES])
    expect(grab('SFX_NAMES')).toEqual([...SFX_NAMES])
  })
})
