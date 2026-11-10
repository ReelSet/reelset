import { describe, expect, it } from 'vitest'
import {
  CAPTION_ONLY_MAX_S,
  echoes,
  finalizeShots,
  isCallToAction,
  lookKey,
  mergeRepeats,
  coordinated,
  heldUntil,
  paceShots,
  splitList,
  termsCard,
} from './finalize'
import { sameIdea } from './ideas'
import type { BrollClip, ReelProps, TimedShot, Word } from './types'

const FPS = 30
const words = (text: string, start = 0, step = 0.4): Word[] =>
  text
    .split(' ')
    .map((t, i) => ({ text: t, start: start + i * step, end: start + i * step + 0.35 }))

const reel = (text: string, extra: Partial<ReelProps> = {}): ReelProps =>
  ({
    durationSeconds: 30,
    title: 'Outlook.com Is Quietly Rejecting Email',
    source: 'hn',
    sourceLabel: 'Hacker News',
    domain: 'mailroute.net',
    words: words(text),
    scenes: [{ kind: 'beat', start: 0, end: 30, text, visual: { type: 'title', title: 'x' } }],
    ...extra,
  }) as unknown as ReelProps

const shot = (
  from: number,
  frames: number,
  show: string,
  props: Record<string, unknown>,
  origin = 'planned',
): TimedShot => ({ from, frames, show, props, sceneIndex: 0, origin }) as TimedShot

const clips = (n: number): BrollClip[] =>
  Array.from({ length: n }, (_, i) => ({ src: `job/broll${i}.mp4`, seconds: 6 }))

const covers = (shots: TimedShot[], total: number) => {
  shots.forEach((s, i) => i > 0 && expect(s.from).toBe(shots[i - 1]!.from + shots[i - 1]!.frames))
  expect(shots.reduce((n, s) => n + s.frames, 0)).toBe(total)
}

const TEXT = Array.from({ length: 70 }, (_, i) => `word${i}`).join(' ')

describe('looks and ideas', () => {
  it('treats timing and footage of the same card as one look, layouts and lists as different', () => {
    const bars = { bars: [{ label: 'A', value: '1%' }], title: 't' }
    expect(lookKey(shot(0, 9, 'BarRace', { ...bars, times: [0] }))).toBe(
      lookKey(shot(9, 9, 'BarRace', { ...bars, times: [2] })),
    )
    expect(lookKey(shot(0, 9, 'KeyPoint', { items: ['a', 'b'] }))).not.toBe(
      lookKey(shot(0, 9, 'KeyPoint', { items: ['c', 'd'] })),
    )
    expect(lookKey(shot(0, 9, 'KeyPoint', { text: '', bg: 1 }))).not.toBe(
      lookKey(shot(0, 9, 'KeyPoint', { text: '', bg: 2 })),
    )
  })

  it('finds the same idea said twice in other words', () => {
    expect(sameIdea('No official announcement', 'Nobody announced it.')).toBe(true)
    expect(sameIdea('Emails are bouncing', 'Prevents spoofing and phishing')).toBe(false)
    const quote = shot(0, 9, 'HNThread', { variant: 'comment', quote: 'Nobody announced it.' })
    expect(echoes(shot(0, 9, 'KeyPoint', { text: 'No Official Announcement' }), quote)).toBe(true)
  })

  it('never calls a stat and its comparison bars an echo, but the same number slammed twice is', () => {
    const stat = shot(0, 9, 'StatSlam', { value: '94.7%', label: 'Average recovery' })
    const bars = shot(9, 9, 'BarRace', {
      title: 'average recovery',
      bars: [{ label: 'P2-MOPD', value: '94.7%' }],
    })
    expect(echoes(stat, bars)).toBe(false)
    const again = shot(9, 9, 'StatSlam', { value: '~90%', label: 'worst-domain recovery' })
    expect(echoes(shot(0, 9, 'StatSlam', { value: '~90%', label: 'x', ring: 1 }), again)).toBe(true)
    expect(echoes(shot(0, 9, 'StatSlam', { value: '20 min', label: 'a' }), again)).toBe(false)
  })

  it('knows a call to action', () => {
    expect(isCallToAction('Check out shootthesound/Fizgig on GitHub')).toBe(true)
    expect(isCallToAction('Watch the tour')).toBe(true)
    expect(isCallToAction('Fix a broken LoRA block')).toBe(false)
  })

  it('merges neighbours with one look into one shot', () => {
    const out = mergeRepeats([
      shot(0, 60, 'StatSlam', { value: '9%', label: 'x' }),
      shot(60, 50, 'StatSlam', { value: '9%', label: 'x' }),
      shot(110, 40, 'KeyPoint', { text: 'a b c' }),
    ])
    expect(out.map((s) => s.frames)).toEqual([110, 40])
  })
})

describe('finalizeShots', () => {
  it('holds no look over 4 s and never restates a long key point in a second layout', () => {
    const text =
      'MOPD is a heavy pipeline so we treat a linear combination of student and expert parameters as one differentiable model today'
    const out = finalizeShots(
      [
        shot(0, 210, 'KeyPoint', { text: 'MOPD is a heavy pipeline' }),
        shot(210, 90, 'StatSlam', { value: '9%', label: 'x' }),
      ],
      reel(text, { words: words(text, 0, 0.3) }),
      FPS,
    )
    covers(out, 300)
    for (const s of out) expect(s.frames).toBeLessThanOrEqual(4 * FPS)
    expect(out.filter((s) => s.props.text === 'MOPD is a heavy pipeline')).toHaveLength(1)
    expect(out.some((s) => s.props.alt !== undefined)).toBe(false)
  })

  it('never slams one number twice in a row', () => {
    const out = finalizeShots(
      [
        shot(0, 60, 'StatSlam', { value: '~90%', label: 'worst-domain recovery' }),
        shot(60, 60, 'StatSlam', { value: '~90%', label: 'worst-domain recovery', bg: 1 }),
        shot(120, 60, 'KeyPoint', { text: 'Experts guide the student' }),
      ],
      reel(TEXT),
      FPS,
    )
    covers(out, 180)
    const stats = out.filter((s) => s.show === 'StatSlam')
    expect(stats).toHaveLength(1)
    expect(stats[0]!.frames).toBeLessThanOrEqual(4 * FPS)
  })

  it('drops the weaker of two neighbours that say one thing; the stronger covers from the start', () => {
    const quote = { variant: 'comment', quote: 'Nobody announced it.', by: 'mailroute.net' }
    const out = finalizeShots(
      [
        shot(0, 60, 'KeyPoint', { text: 'No Official Announcement' }),
        shot(60, 60, 'HNThread', quote),
        shot(120, 60, 'StatSlam', { value: '9%', label: 'x' }),
      ],
      reel(TEXT),
      FPS,
    )
    covers(out, 180)
    expect(out[0]!.show).toBe('HNThread')
    expect(out.some((s) => s.props.text === 'No Official Announcement')).toBe(false)
  })

  it('turns a call-to-action key point before the end card into end-card time', () => {
    const out = finalizeShots(
      [
        shot(0, 90, 'StatSlam', { value: '9%', label: 'x' }),
        shot(90, 50, 'KeyPoint', { text: 'Check out acme/widget on GitHub' }),
        shot(140, 60, 'EndCard', {}),
      ],
      reel(TEXT),
      FPS,
    )
    covers(out, 200)
    expect(out.map((s) => s.show)).toEqual(['StatSlam', 'EndCard'])
    expect(out[1]!.frames).toBe(110)
  })

  it('never leaves caption-only footage running 3 s or more', () => {
    const out = finalizeShots(
      [
        shot(0, 60, 'StatSlam', { value: '9%', label: 'x' }),
        shot(60, 150, 'KeyPoint', { text: '', bg: 0 }),
        shot(210, 60, 'StatSlam', { value: '12%', label: 'y' }),
      ],
      reel(TEXT, { broll: clips(3) }),
      FPS,
    )
    covers(out, 270)
    for (const s of out) {
      if (s.show === 'KeyPoint' && !s.props.text && !s.props.items)
        expect(s.frames).toBeLessThanOrEqual(CAPTION_ONLY_MAX_S * FPS)
    }
  })

  it('never lets a cue shot lose its word to a neighbour', () => {
    const cue = shot(60, 90, 'StatSlam', { value: '9%', label: 'x' }, 'cue')
    const out = finalizeShots(
      [shot(0, 60, 'KeyPoint', { text: '', bg: 0 }), cue],
      reel(TEXT, { broll: clips(2) }),
      FPS,
    )
    expect(out.find((s) => s.show === 'StatSlam')!.from).toBe(60)
  })
})

describe('terms card', () => {
  it('lights the things being named, in spoken order, when two or more are said', () => {
    const text =
      'by treating a linear combination of student and expert parameters as one differentiable model'
    const card = termsCard(shot(0, 110, 'KeyPoint', { text: '' }), reel(text), FPS)!
    expect(card.props.items).toEqual(expect.arrayContaining(['expert parameters']))
    expect((card.props.items as string[]).length).toBeGreaterThanOrEqual(2)
    const times = card.props.times as number[]
    expect([...times].sort((a, b) => a - b)).toEqual(times)
  })

  it('offers nothing for a span over 4 s or without two terms', () => {
    expect(termsCard(shot(0, 150, 'KeyPoint', { text: '' }), reel(TEXT), FPS)).toBeNull()
    expect(
      termsCard(shot(0, 60, 'KeyPoint', { text: '' }), reel('and then it was'), FPS),
    ).toBeNull()
  })
})

describe('paceShots', () => {
  it('reaches the pace with new picks, never a second copy of the same look or number', () => {
    const shots = [
      shot(0, 120, 'KeyPoint', { text: 'MOPD is a heavy pipeline' }),
      shot(120, 120, 'StatSlam', { value: '9%', label: 'x' }),
      shot(240, 120, 'RepoDemo', {}),
    ]
    const out = paceShots(shots, reel(TEXT), FPS)
    covers(out, 360)
    expect(out.length).toBeGreaterThan(3)
    expect(out.filter((s) => s.show === 'RepoDemo')).toHaveLength(1)
    out.forEach((s, i) => {
      if (i === 0) return
      expect(lookKey(s)).not.toBe(lookKey(out[i - 1]!))
      expect(echoes(out[i - 1]!, s)).toBe(false)
    })
    expect(out.filter((s) => s.show === 'StatSlam')).toHaveLength(1)
  })
})

describe('terms and splits', () => {
  it('never offers a number as a term and keeps a coordinated head whole', () => {
    const text = 'it now takes twenty minutes on eight gigabytes of memory'
    const card = termsCard(shot(0, 100, 'KeyPoint', { text: '' }), reel(text), FPS, 1)
    for (const item of (card?.props.items as string[] | undefined) ?? [])
      expect(item).not.toMatch(/twenty|eight/)
    expect(
      coordinated(
        'linear combination of student',
        'linear combination of student and expert parameters',
      ),
    ).toBe('linear combination')
    expect(coordinated('source of supervision', 'a source of supervision, guiding')).toBe(
      'source of supervision',
    )
  })

  it('splits a long list card where an item is said, the second card in the other layout', () => {
    const s = shot(0, 120, 'KeyPoint', {
      items: ['spoofing', 'phishing', 'business email compromise'],
      kicker: 'DMARC prevents',
      times: [0.2, 0.9, 2.1],
    })
    const [a, b] = splitList(s, FPS)!
    expect(a!.props.items).toEqual(['spoofing', 'phishing'])
    expect(b!.props.items).toEqual(['business email compromise'])
    expect(b!.props.layout).toBe(1)
    expect(b!.props.times).toEqual([0.1])
    expect(a!.frames + b!.frames).toBe(120)
    expect(splitList({ ...s, frames: 60 }, FPS)).toBeNull()
    expect(splitList(b!, FPS)).toBeNull()
  })

  it('keeps a stat on screen until its number has been said', () => {
    const text = 'it also raised worst-domain recovery to nearly 90% today'
    const s = shot(0, 120, 'StatSlam', { value: '~90%', label: 'worst-domain recovery' })
    expect(heldUntil(s, reel(text), FPS)).toBeCloseTo(7 * 0.4 + 0.35 + 0.4)
    expect(heldUntil(shot(0, 120, 'KeyPoint', { text: 'x y' }), reel(text), FPS)).toBe(0)
  })

  it("cuts the hook's first shot within 2.4 s", () => {
    const text = 'Training an image model LoRA used to take almost an hour now it takes less'
    const p = reel(text, {
      scenes: [{ kind: 'hook', start: 0, end: 6, text }],
      broll: clips(2),
    } as Partial<ReelProps>)
    const out = finalizeShots(
      [
        shot(0, 120, 'ImageFull', { image: 0 }),
        shot(120, 60, 'StatSlam', { value: '9%', label: 'x' }),
      ],
      p,
      FPS,
    )
    covers(out, 180)
    expect(out[0]!.show).toBe('ImageFull')
    expect(out[0]!.frames).toBeLessThanOrEqual(2.4 * FPS)
    expect(lookKey(out[1]!)).not.toBe(lookKey(out[0]!))
  })
})
