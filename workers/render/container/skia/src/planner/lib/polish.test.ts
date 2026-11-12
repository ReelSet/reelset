import { describe, expect, it } from 'vitest'
import { assignBroll, dropRepeatedClips, repeatedClips } from './broll'
import { barProps, withMeasure } from './numbers'
import { fillEmpty, wordCueKeyPoints } from './polish'
import { STATS_FLOOR, countSaid, sourceVariants } from './sources'
import { fitWindow, sentencesUpTo } from './text'
import { comparisonFor, demoOnCue } from './timeline'
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
  it('never shows a claim that only repeats the captions under it', () => {
    const [out] = wordCueKeyPoints(
      [shot(0, 90, 'KeyPoint', { text: 'MOPD is a heavy pipeline' }, 'cue')],
      reel(text),
      FPS,
    )
    expect(out!.props.text).toBe('')
    expect(out!.origin).toBe('planned')
  })

  it("keeps the script's own statement in sentence case when it adds something", () => {
    const [out] = wordCueKeyPoints(
      [shot(84, 90, 'KeyPoint', { text: 'experts guide the student' }, 'cue')],
      reel(text),
      FPS,
    )
    expect(out!.props.text).toBe('Experts guide the student')
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

  it('never turns a cue that names things into a card of keyword fragments', () => {
    const [out] = wordCueKeyPoints(
      [shot(0, 90, 'KeyPoint', { text: 'Linear parameter combination' }, 'cue')],
      reel('of student and expert parameters as one model'),
      FPS,
    )
    expect(out!.props.items).toBeUndefined()
    expect(out!.props.terms).toBeUndefined()
    expect(out!.props.text).toBe('')
  })

  it('frees a cue with nothing honest to say for the planner', () => {
    const [out] = wordCueKeyPoints(
      [shot(0, 90, 'KeyPoint', { text: 'Linear parameter combination' }, 'cue')],
      reel('and then it was so'),
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

  const tableReel = (narration: string) =>
    reel(narration, {
      scenes: [
        {
          kind: 'beat',
          start: 0,
          end: 12,
          text: narration,
          visual: { type: 'title', title: 'x' },
          shots: [
            {
              at: 'one',
              show: 'TableScreen',
              props: {
                ref: 'Table 1',
                headers: ['Method', 'Score'],
                rows: ['Baseline|61.2', 'Ours|94.7', 'Other|12.0'],
              },
            },
          ],
        },
      ],
    } as Partial<ReelProps>)

  it('puts a paper table in an empty slot only when a number said over it is a cell', () => {
    const said = tableReel(
      'one two three four five six seven eight nine ten eleven Ours reaches 94.7% now',
    )
    const out = fillEmpty(
      [shot(0, 120, 'EndCard', {}), shot(120, 120, 'KeyPoint', { text: '' })],
      said,
      FPS,
    )
    expect(out[1]!.show).toBe('TableScreen')
    expect(out[1]!.props.value).toBe('94.7')
    const silent = tableReel(text)
    const none = fillEmpty(
      [shot(0, 120, 'EndCard', {}), shot(120, 120, 'KeyPoint', { text: '' })],
      silent,
      FPS,
    )
    expect(none.some((s) => s.show === 'TableScreen')).toBe(false)
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

describe('b-roll uniqueness', () => {
  it('never shows a clip twice: a shot that finds no free clip gets none', () => {
    const clips = [{ src: 'a.mp4', seconds: 6 }] as BrollClip[]
    const shots = [
      shot(0, 60, 'KeyPoint', { text: '', bg: 0 }),
      shot(60, 60, 'StatSlam', { value: '1%', label: 'x' }),
      shot(120, 60, 'KeyPoint', { text: 'a b' }),
      shot(180, 60, 'StatSlam', { value: '2%', label: 'y' }),
      shot(240, 60, 'KeyPoint', { text: '' }),
    ]
    const out = assignBroll(shots, clips)
    expect(repeatedClips(out)).toEqual([])
    expect(out[4]!.props.bg).toBeUndefined()
    expect(out[4]!.props.bgAt).toBeUndefined()
  })

  it('gives every empty shot a clip of its own before any text shot', () => {
    const clips = Array.from({ length: 3 }, (_, i) => ({
      src: `${i}.mp4`,
      seconds: 6,
    })) as BrollClip[]
    const shots = [
      shot(0, 60, 'KeyPoint', { text: 'one two' }),
      shot(60, 60, 'KeyPoint', { text: '' }),
      shot(120, 60, 'KeyPoint', { text: '' }),
      shot(180, 60, 'StatSlam', { value: '2%', label: 'y' }),
    ]
    const out = assignBroll(shots, clips)
    expect(typeof out[1]!.props.bg).toBe('number')
    expect(typeof out[2]!.props.bg).toBe('number')
    expect(repeatedClips(out)).toEqual([])
  })

  it('drops a repeated clip as a last safety net', () => {
    const out = dropRepeatedClips([
      shot(0, 60, 'KeyPoint', { text: '', bg: 1 }),
      shot(60, 60, 'KeyPoint', { text: 'a b', bg: 1 }),
    ])
    expect(out[0]!.props.bg).toBe(1)
    expect(out[1]!.props.bg).toBeUndefined()
  })
})

describe('source looks', () => {
  it('slams engagement only when it is real social proof', () => {
    const reddit = (upvotes: number, comments: number) =>
      sourceVariants('RedditPost', {
        facts: { reddit: { upvotes, comments } },
        scenes: [],
      } as never)
    const said = [{ kind: 'beat', text: 'It got 521 points and 300 upvotes on the front page.' }]
    const redditSaid = (upvotes: number) =>
      sourceVariants('RedditPost', {
        facts: { reddit: { upvotes, comments: 0 } },
        scenes: said,
      } as never)
    expect(reddit(75, 16)).not.toContain('stats')
    expect(redditSaid(STATS_FLOOR.reddit)).toContain('stats')
    const hn = (scenes: unknown[]) =>
      sourceVariants('HNThread', { facts: { hn: { points: 521, comments: 347 } }, scenes } as never)
    expect(hn(said)).toContain('stats')
    expect(hn([{ kind: 'beat', text: 'Outlook is rejecting mail.' }])).not.toContain('stats')
  })

  it('counts a number as said only when the narration says it', () => {
    const scenes = [{ kind: 'beat', text: 'It has 1,240 stars (and 521 points).' }] as never
    expect(countSaid({ scenes }, 1240)).toBe(true)
    expect(countSaid({ scenes }, 521)).toBe(true)
    expect(countSaid({ scenes }, 347)).toBe(false)
    expect(countSaid({ scenes }, undefined)).toBe(false)
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
