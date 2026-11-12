import { describe, expect, it } from 'vitest'
import { sampleReel } from './fixtures'
import {
  applyHook,
  bleedsWell,
  hookChoice,
  hookHeadline,
  hookProof,
  hookStat,
  isScrollStopper,
  statSaysHeadline,
} from './hook'
import type { ReelProps, TimedShot } from './types'

const shot = (show: string, props: Record<string, unknown> = {}): TimedShot =>
  ({ from: 0, frames: 60, show, props, sceneIndex: 0, origin: 'planned' }) as TimedShot

const withHook = (text: string, later = 'It runs on a server.'): Partial<ReelProps> => {
  const p = sampleReel()
  return {
    scenes: [
      { kind: 'hook', start: 0, end: 3, text },
      { kind: 'beat', start: 3, end: 8, text: later, visual: { type: 'title', title: 'x y' } },
      { kind: 'outro', start: 8, end: 10, text: 'Follow.' },
    ],
    words: p.words,
    images: [],
    broll: undefined,
  }
}

describe('first-shot choice', () => {
  it('opens on the hook stat when the hook says a number nothing later repeats', () => {
    const p = sampleReel(withHook('Training used to take 49 minutes.'))
    expect(hookStat(p)).toMatchObject({ value: expect.stringContaining('49') })
    expect(hookChoice(p).show).toBe('StatSlam')
  })

  it('skips a hook number a later scene repeats (the bars show it there)', () => {
    const p = sampleReel(withHook('It takes 20 minutes.', 'Now 20 minutes, down from 49.'))
    expect(hookStat(p)).toBeNull()
  })

  it('opens on the README demo when there is one', () => {
    const p = sampleReel({
      ...withHook('Training is faster.'),
      demo: { src: 'job/demo.mp4', seconds: 6, repo: 'a/b' },
    })
    expect(hookChoice(p).show).toBe('RepoDemo')
  })

  it('opens full-bleed on a photo or portrait picture, never a wide share card', () => {
    expect(bleedsWell({ src: 'a', kind: 'og', width: 1200, height: 630 }, 'news')).toBe(false)
    expect(bleedsWell({ src: 'a', kind: 'og', width: 1000, height: 1100 }, 'news')).toBe(true)
    expect(bleedsWell({ src: 'a', kind: 'figure', width: 900, height: 900 }, 'papers')).toBe(false)
    expect(bleedsWell({ src: 'a', kind: 'thumbnail', width: 1280, height: 720 }, 'youtube')).toBe(
      true,
    )
    const p = sampleReel({
      ...withHook('Something happened.'),
      images: [{ src: 'job/i.jpg', kind: 'og', width: 1000, height: 1100 }],
    })
    expect(hookChoice(p)).toEqual({ show: 'ImageFull', props: { image: 0, bleed: true } })
  })

  it('uses big real social proof only', () => {
    const base = withHook('Something happened.')
    const hn = (points: number) =>
      sampleReel({ ...base, source: 'hn', facts: { hn: { points, comments: 3 } } })
    expect(hookProof(hn(1200))).toEqual({ value: '1,200', label: 'points on Hacker News' })
    expect(hookProof(hn(40))).toBeNull()
    expect(hookChoice(hn(1200)).props).toMatchObject({ proof: true })
    // 521 points is respectable, not the story: the headline opens the reel.
    expect(hookProof(hn(521))).toBeNull()
    expect(hookChoice(hn(521)).props).toMatchObject({ hook: true })
  })

  it('falls back to the headline itself, huge, over the story image: never a small thumbnail', () => {
    const p = sampleReel({
      ...withHook('Consolidating expert models can be slow and uneven.'),
      source: 'papers',
      headline: 'Accelerating multi-teacher distillation',
      images: [{ src: 'job/t.png', kind: 'thumbnail', width: 1200, height: 648 }],
    })
    const choice = hookChoice(p)
    expect(choice.show).toBe('KeyPoint')
    expect(choice.props).toMatchObject({ hook: true, bgImage: 0 })
    expect(choice.props.text).toBe('Accelerating multi-teacher distillation')
  })

  it('caps the headline at 7 words', () => {
    const p = sampleReel({
      ...withHook('x y'),
      headline: 'one two three four five six seven eight',
    })
    expect(hookHeadline(p)).toBe('one two three four five six seven')
  })
})

describe('applyHook', () => {
  const p = sampleReel(withHook('Training used to take 49 minutes.'))

  it('replaces a first shot that is a thumbnail in a blurred surround or a source card', () => {
    for (const bad of [shot('ImageFull', { image: 0 }), shot('PaperPage'), shot('HNThread')]) {
      expect(isScrollStopper(bad)).toBe(false)
      const out = applyHook([bad, shot('KeyPoint')], p)
      expect(isScrollStopper(out[0]!)).toBe(true)
      expect(out[0]!.frames).toBe(60)
      expect(out[1]!.show).toBe('KeyPoint')
    }
  })

  it('keeps a first shot that already stops the scroll', () => {
    const stat = shot('StatSlam', { value: '9%', label: 'x' })
    expect(applyHook([stat], p)[0]).toBe(stat)
    expect(isScrollStopper(shot('ImageFull', { image: 0, bleed: true }))).toBe(true)
  })

  it('drops a later stat that repeats a number the hook stat shows, "was X" included', () => {
    const hook = shot('StatSlam', { value: '94.7%', label: '1.7B recovery · was 80.9%' })
    const out = applyHook(
      [
        hook,
        shot('KeyPoint'),
        shot('StatSlam', { value: '80.9%', label: 'MOPD' }),
        shot('StatSlam', { value: '3x', label: 'faster' }),
      ],
      p,
    )
    expect(out[2]!.show).toBe('KeyPoint')
    expect(out[3]!.show).toBe('StatSlam')
  })
})

describe('statSaysHeadline', () => {
  it('is true when the opening stat has the number the headline leads with', () => {
    const stat = shot('StatSlam', { value: '94.7%', label: 'recovery' })
    expect(statSaysHeadline(stat, '94.7% RECOVERY, UP FROM 80.9%')).toBe(true)
    expect(statSaysHeadline(stat, 'Outlook rejects mail without DMARC')).toBe(false)
    expect(statSaysHeadline(shot('KeyPoint'), '94.7% RECOVERY')).toBe(false)
    expect(statSaysHeadline(undefined, '94.7%')).toBe(false)
  })
})
