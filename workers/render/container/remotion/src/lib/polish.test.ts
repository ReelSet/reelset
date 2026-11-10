import { describe, expect, it } from 'vitest'
import { assignBroll } from './broll'
import { barProps, withMeasure } from './numbers'
import { fillEmpty, pacePunches, wordCueKeyPoints } from './polish'
import { STATS_FLOOR, sourceVariants } from './sources'
import { fitWindow, sentencesUpTo } from './text'
import { comparisonFor, demoOnCue, splitSpan } from './timeline'
import { displayTitle } from './typeset'
import type { BrollClip, ReelProps, TimedShot, Word } from './types'

const FPS = 30
const words = (text: string, start = 0, step = 0.4): Word[] =>
  text
    .split(' ')
    .map((t, i) => ({ text: t, start: start + i * step, end: start + i * step + 0.35 }))

const reel = (text: string, extra: Partial<ReelProps> = {}): ReelProps =>
  ({
    durationSeconds: 12,
    title: 'A title',
    source: 'hn',
    sourceLabel: 'HN',
    domain: 'x.com',
    words: words(text),
    scenes: [{ kind: 'beat', start: 0, end: 12, text, visual: { type: 'title', title: 'x' } }],
    ...extra,
  }) as unknown as ReelProps

const shot = (
  from: number,
  frames: number,
  show: string,
  props: Record<string, unknown>,
  origin = 'planned',
): TimedShot => ({ from, frames, show, props, sceneIndex: 0, origin }) as TimedShot

const covers = (shots: TimedShot[], total: number) => {
  shots.forEach((s, i) => i > 0 && expect(s.from).toBe(shots[i - 1]!.from + shots[i - 1]!.frames))
  expect(shots.reduce((n, s) => n + s.frames, 0)).toBe(total)
}

describe('wordCueKeyPoints', () => {
  const text = "But MOPD is a heavy pipeline and often doesn't recover all domains evenly."
  it('replaces a label the model gave with the claim of the sentence', () => {
    const [out] = wordCueKeyPoints(
      [shot(0, 90, 'KeyPoint', { text: 'Heavy pipeline' }, 'cue')],
      reel(text),
      FPS,
    )
    expect(out!.props.text).toBe('MOPD is a heavy pipeline')
    expect(out!.origin).toBe('cue')
  })

  it('turns a key point holding a spoken number into that stat', () => {
    const t = 'the Muon optimizer runs 12 times faster.'
    const [out] = wordCueKeyPoints(
      [shot(0, 90, 'KeyPoint', { text: 'Muon optimizer 12x faster' }, 'cue')],
      reel(t),
      FPS,
    )
    expect(out!.show).toBe('StatSlam')
    expect(out!.props.value).toBe('12×')
  })

  it('frees a cue with nothing honest to say for the planner', () => {
    const [out] = wordCueKeyPoints(
      [shot(0, 90, 'KeyPoint', { text: 'Linear parameter combination' }, 'cue')],
      reel('of student and expert parameters as one model'),
      FPS,
    )
    expect(out!.props.text).toBe('')
    expect(out!.origin).toBe('planned')
  })
})

describe('fillEmpty', () => {
  const text =
    'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen'
  it('gives an empty shot to its neighbours (each <= 4 s) instead of showing nothing', () => {
    const shots = [
      shot(0, 60, 'StatSlam', { value: '9%', label: 'x' }),
      shot(60, 60, 'KeyPoint', { text: '' }),
      shot(120, 60, 'KeyPoint', { text: 'Fix a broken LoRA block' }),
    ]
    const out = fillEmpty(shots, reel(text), FPS)
    expect(out.map((s) => s.show)).toEqual(['StatSlam', 'KeyPoint'])
    covers(out, 180)
    for (const s of out) expect(s.frames).toBeLessThanOrEqual(4 * FPS)
  })

  it('puts an unused paper table in an empty slot of its own scene, plain when no number is said', () => {
    const p = reel(text, {
      scenes: [
        {
          kind: 'beat',
          start: 0,
          end: 12,
          text,
          visual: { type: 'title', title: 'x' },
          shots: [
            {
              at: 'one',
              show: 'TableScreen',
              props: { ref: 'Table 1', headers: ['M', 'A'], rows: ['x|1'] },
            },
          ],
        },
      ],
    } as Partial<ReelProps>)
    const out = fillEmpty(
      [shot(0, 120, 'EndCard', {}), shot(120, 120, 'KeyPoint', { text: '' })],
      p,
      FPS,
    )
    expect(out[1]!.show).toBe('TableScreen')
    expect(out[1]!.props.plain).toBe(true)
  })

  it('leaves a remainder of at least 1.2 s rather than a flash', () => {
    const shots = [
      shot(0, 90, 'KeyPoint', { text: 'Fix a broken LoRA block' }),
      shot(90, 110, 'KeyPoint', { text: '' }),
      shot(200, 90, 'KeyPoint', { text: 'Find the best epoch by eye' }),
    ]
    const out = fillEmpty(shots, reel(text), FPS)
    covers(out, 290)
    const empty = out.find((s) => !s.props.text)
    if (empty) expect(empty.frames).toBeGreaterThanOrEqual(36)
  })
})

describe('pacePunches', () => {
  it('splits the longest still holds with a punch-in until the average is <= 2.4 s', () => {
    const t = Array.from({ length: 40 }, (_, i) => `w${i}`).join(' ')
    const shots = [
      shot(0, 120, 'KeyPoint', { text: 'MOPD is a heavy pipeline' }),
      shot(120, 120, 'StatSlam', { value: '9%', label: 'x' }),
      shot(240, 120, 'RepoDemo', {}),
    ]
    const out = pacePunches(shots, reel(t), FPS)
    covers(out, 360)
    expect(out.length / (360 / FPS)).toBeGreaterThanOrEqual(1 / 2.4)
    const punched = out.filter((s) => s.props.punch)
    expect(punched.every((s) => s.show !== 'RepoDemo')).toBe(true)
    for (const p of punched) {
      const { lead, frames } = p.props.punch as { lead: number; frames: number }
      expect(lead).toBeGreaterThanOrEqual(1.4 * FPS - 1)
      expect(frames).toBe(120)
    }
  })
})

describe('comparisons', () => {
  const text =
    "For a 1.7B model, P^2-MOPD achieved 94.7% average recovery, surpassing MOPD's 80.9%."
  it('names both sides of a comparison', () => {
    const c = comparisonFor(text, 94.7)!
    expect(c.bars).toEqual({
      title: 'average recovery',
      bars: [
        { label: 'P^2-MOPD', value: '94.7%' },
        { label: 'MOPD', value: '80.9%' },
      ],
    })
  })

  it('reads "from X to Y" as before and now', () => {
    const c = comparisonFor(
      'Memory drops too. Krea 2 training falls from 22.9 to 14.9 gigabytes.',
      14.9,
    )!
    expect(c.bars).toEqual({
      title: 'Krea 2 training memory',
      bars: [
        { label: 'Before', value: '22.9GB' },
        { label: 'Now', value: '14.9GB' },
      ],
    })
  })

  it('splits a long build into pieces of at most 4 s', () => {
    expect(splitSpan(0, 3, 2)).toEqual([[0, 3]])
    expect(splitSpan(0, 6, 3.5)).toEqual([
      [0, 3.5],
      [3.5, 6],
    ])
    for (const [a, b] of splitSpan(0, 9, 8.5)!) expect(b! - a!).toBeLessThanOrEqual(4)
    expect(splitSpan(0, 20, 1)).toBeNull()
  })

  it('keeps unrelated labels apart', () => {
    expect(
      barProps(
        { raw: '5%', label: 'speed', sentence: '', index: 0 },
        { raw: '7%', label: 'cost', sentence: '', index: 5 },
      ).title,
    ).toBeUndefined()
  })

  it('says what a size measures when the narration does', () => {
    expect(withMeasure('Krea 2 training · from 22.9GB', 'GB', 'Memory drops too.')).toBe(
      'Krea 2 training memory · from 22.9GB',
    )
    expect(withMeasure('model weights', 'GB', 'It is big.')).toBe('model weights')
    expect(withMeasure('Krea 2 training', '%', 'memory')).toBe('Krea 2 training')
  })
})

describe('demoOnCue', () => {
  it('moves the demo cut onto "Watch"', () => {
    const p = reel('find the best epoch by eye. Watch the tour now')
    const watch = p.words.find((w) => w.text === 'Watch')!
    const at = Math.round(watch.start * FPS)
    const out = demoOnCue(
      [shot(0, at + 10, 'KeyPoint', { text: 'x y' }), shot(at + 10, 60, 'RepoDemo', {})],
      p,
      FPS,
    )
    expect(out[1]!.from).toBe(at)
    covers(out, at + 70)
  })
})

describe('b-roll reuse', () => {
  it('gives an otherwise empty shot a used clip, later in the clip, never next to itself', () => {
    const clips = [{ src: 'a.mp4', seconds: 6 }] as BrollClip[]
    const shots = [
      shot(0, 60, 'KeyPoint', { text: '', bg: 0 }),
      shot(60, 60, 'StatSlam', { value: '1%', label: 'x' }),
      shot(120, 60, 'KeyPoint', { text: 'a b' }),
      shot(180, 60, 'StatSlam', { value: '2%', label: 'y' }),
      shot(240, 60, 'KeyPoint', { text: '' }),
    ]
    const out = assignBroll(shots, clips)
    expect(out[4]!.props.bg).toBe(0)
    expect(out[4]!.props.bgAt).toBe(3)
  })
})

describe('source looks', () => {
  it('slams engagement only when it is real social proof', () => {
    const reddit = (upvotes: number, comments: number) =>
      sourceVariants('RedditPost', {
        facts: { reddit: { upvotes, comments } },
        scenes: [],
      } as never)
    expect(reddit(75, 16)).not.toContain('stats')
    expect(reddit(STATS_FLOOR.reddit, 0)).toContain('stats')
    expect(
      sourceVariants('HNThread', {
        facts: { hn: { points: 521, comments: 347 } },
        scenes: [],
      } as never),
    ).toContain('stats')
  })
})

describe('text fitting', () => {
  it('shortens a window until it fits the box', () => {
    const long = 'word '.repeat(200).trim()
    const { body, size } = fitWindow(
      long,
      '',
      { width: 900, height: 300 },
      { min: 40, max: 58, charWidth: 0.52, lineHeight: 1.3 },
    )
    expect(size).toBeGreaterThanOrEqual(40)
    expect(body.length).toBeLessThan(long.length)
  })

  it('quotes whole sentences', () => {
    expect(sentencesUpTo('Training is much faster. Other models have had boosts too.', 40)).toBe(
      'Training is much faster.',
    )
  })

  it('drops an accidental doubled word from a source title', () => {
    expect(displayTitle('Moss training has has a very large speed boost')).toBe(
      'Moss training has a very large speed boost',
    )
  })
})
