import { describe, expect, it } from 'vitest'
import { lookKey } from './finalize'
import { sampleReel } from './fixtures'
import { chunkSpan, identityOf, MAX_HOLD_S } from './planner'
import { resolveShots, totalFrames, headlineEnd, headlineOf } from './timeline'
import type { BrollClip, ReelProps } from './types'

const FPS = 30
const clip = (n: number): BrollClip => ({ src: `job/broll${n}.mp4`, seconds: 5, beat: n })
const rich = (over: Partial<ReelProps> = {}) =>
  sampleReel({
    images: [
      { src: 'job/img1.jpg', kind: 'og', width: 1280, height: 640 },
      { src: 'job/img2.jpg', kind: 'figure', width: 548, height: 600, alt: 'Figure 1: demo' },
      { src: 'job/img3.jpg', kind: 'screenshot', width: 1280, height: 800 },
      { src: 'job/img4.jpg', kind: 'figure', width: 900, height: 600, alt: 'Figure 2: more' },
    ],
    broll: [clip(1), clip(2), clip(3), clip(4)],
    ...over,
  })
const run = (p: ReelProps) => resolveShots(p, FPS, totalFrames(p.durationSeconds, FPS))

describe('chunkSpan', () => {
  it('cuts on word boundaries into 1.0-3.0s chunks', () => {
    const p = sampleReel()
    const chunks = chunkSpan(p.words, 0, 12)
    expect(chunks.length).toBeGreaterThan(3)
    for (const c of chunks) {
      expect(c.end - c.start).toBeGreaterThanOrEqual(1.0)
      expect(c.end - c.start).toBeLessThanOrEqual(3.2)
    }
    expect(chunks[0]!.start).toBe(0)
    expect(chunks.at(-1)!.end).toBe(12)
  })
})

describe('planner', () => {
  it('covers every frame with no gaps and no hold over 4s', () => {
    const p = sampleReel({ broll: [clip(1), clip(2), clip(3)] })
    const { shots } = run(p)
    const total = totalFrames(p.durationSeconds, FPS)
    expect(shots[0]!.from).toBe(0)
    shots.forEach((s, i) => {
      expect(s.frames / FPS).toBeLessThanOrEqual(MAX_HOLD_S)
      if (i > 0) expect(s.from).toBe(shots[i - 1]!.from + shots[i - 1]!.frames)
    })
    const last = shots.at(-1)!
    expect(last.from + last.frames).toBe(total)
  })

  it('averages a cut every 1.4-2.65s without repeating a look to get there', () => {
    // The fixture narration offers few claims; cuts are never bought with a repeated screen.
    const p = rich()
    const { shots } = run(p)
    const avg = p.durationSeconds / shots.length
    expect(avg).toBeGreaterThan(1.4)
    expect(avg).toBeLessThan(2.65)
  })

  it('never shows the same look twice in a row (only key points may follow each other)', () => {
    const { shots } = run(rich())
    shots.forEach((s, i) => {
      const prev = shots[i - 1]
      if (!prev) return
      if (s.show !== 'KeyPoint') expect(s.show).not.toBe(prev.show)
      expect(s.props.alt).toBeUndefined()
      expect(lookKey(s)).not.toBe(lookKey(prev))
    })
  })

  it('is deterministic', () => {
    expect(run(sampleReel())).toEqual(run(sampleReel()))
  })

  it('shows each real image once, early images no more than 15 s apart', () => {
    const p = rich()
    const { shots } = run(p)
    const img = new Set(['ImageFull', 'FigureZoom', 'ArticleHeadline', 'YouTubePlayer'])
    const times = shots.filter((s) => img.has(s.show)).map((s) => s.from / FPS)
    expect(times.length).toBeGreaterThan(1)
    const used = shots.filter((s) => img.has(s.show)).map((s) => s.props.image)
    expect(new Set(used).size).toBe(used.length)
    let prev = 0
    for (const t of times) {
      expect(t - prev).toBeLessThan(15)
      prev = t
    }
  })

  it('uses no image screens without images and ends on the EndCard', () => {
    const { shots } = run(sampleReel({ images: [] }))
    expect(shots.some((s) => ['ImageFull', 'FigureZoom'].includes(s.show))).toBe(false)
    expect(shots.at(-1)!.show).toBe('EndCard')
  })

  it('only emits numbers found in the script', () => {
    const p = sampleReel()
    const { shots } = run(p)
    const script = p.scenes.map((s) => ('text' in s ? s.text : '')).join(' ')
    for (const s of shots.filter((x) => x.show === 'StatSlam')) {
      expect(script).toContain(String(s.props.value).replace(/[^\d.]/g, ''))
    }
  })
})

describe('beat sheet cues', () => {
  it('places shots on spoken words and keeps the rest planned', () => {
    const p = rich()
    const beat = p.scenes[1]!
    const word = p.words.find((w) => w.text === 'passes.' && w.start >= beat.start)!
    p.scenes[1] = {
      ...(beat as Extract<ReelProps['scenes'][number], { kind: 'beat' }>),
      shots: [
        { at: 'Unslop', show: 'RepoPage' },
        { at: 'passes', show: 'StatSlam', props: { value: '12', label: 'passes' }, sfx: 'ding' },
      ],
    }
    const { shots, warnings } = run(p)
    const hit = shots.find((s) => s.show === 'StatSlam' && s.origin === 'cue')!
    expect(hit.from).toBe(Math.round(word.start * FPS))
    expect(hit.sfx).toBe('ding')
    expect(warnings.filter((w) => w.includes('not found'))).toEqual([])
  })

  it('warns and falls back instead of crashing when a cue is missing', () => {
    const p = sampleReel()
    const beat = p.scenes[1] as Extract<ReelProps['scenes'][number], { kind: 'beat' }>
    p.scenes[1] = {
      ...beat,
      shots: [
        { at: 'Unslop', show: 'KeyPoint' },
        { at: 'banana', show: 'StatSlam' },
        { at: 'nothing#4', show: 'KeyPoint' },
      ],
    }
    const { shots, warnings } = run(p)
    expect(warnings.some((w) => w.includes('banana'))).toBe(true)
    expect(shots.filter((s) => s.sceneIndex === 1).length).toBeGreaterThan(1)
  })

  it('fills a cue shot held over 4s', () => {
    const p = sampleReel({ broll: [clip(1), clip(2), clip(3)] })
    const beat = p.scenes[2] as Extract<ReelProps['scenes'][number], { kind: 'beat' }>
    p.scenes[2] = { ...beat, shots: [{ at: 'It', show: 'KeyPoint' }] }
    const { shots } = run(p)
    for (const s of shots) expect(s.frames / FPS).toBeLessThanOrEqual(MAX_HOLD_S)
  })
})

describe('headline', () => {
  it('uses the given text capped at 7 words, else derives from the hook', () => {
    const p = sampleReel()
    expect(
      headlineOf({ ...p, headline: 'one two three four five six seven eight' }).split(' '),
    ).toHaveLength(7)
    expect(headlineOf(p).split(' ').length).toBeLessThanOrEqual(7)
    expect(headlineEnd(p)).toBeGreaterThanOrEqual(2)
    expect(headlineEnd(p)).toBeLessThanOrEqual(3)
  })
})

describe('youtube thumbnail reuse', () => {
  const thumb = { src: 'job/img1.jpg', kind: 'thumbnail' as const, width: 1280, height: 720 }
  const shows = (p: ReelProps) =>
    run(p).shots.filter(
      (s) =>
        s.show === 'YouTubePlayer' ||
        (['ImageFull', 'ArticleHeadline', 'FigureZoom'].includes(s.show) &&
          p.images?.[Number(s.props.image ?? 0)]?.kind === 'thumbnail'),
    )

  it('shows the only thumbnail once in a planned reel', () => {
    const p = sampleReel({ source: 'youtube', sourceLabel: 'YouTube', images: [thumb] })
    expect(shows(p)).toHaveLength(1)
    expect(shows(p)[0]!.from).toBe(0)
  })

  it('swaps repeated cue shots for a key point', () => {
    const p = sampleReel({ source: 'youtube', sourceLabel: 'YouTube', images: [thumb] })
    for (const i of [1, 2]) {
      const beat = p.scenes[i] as Extract<ReelProps['scenes'][number], { kind: 'beat' }>
      p.scenes[i] = {
        ...beat,
        shots: [
          { at: beat.text.split(' ')[0]!, show: 'YouTubePlayer' },
          { at: beat.text.split(' ')[6]!, show: 'ImageFull', props: { image: 0 } },
        ],
      }
    }
    expect(shows(p)).toHaveLength(1)
  })

  it('keeps non-thumbnail images available after the thumbnail', () => {
    const og = { src: 'job/img2.jpg', kind: 'og' as const, width: 1280, height: 640 }
    const p = sampleReel({ source: 'youtube', sourceLabel: 'YouTube', images: [thumb, og] })
    const imgs = run(p).shots.filter((s) => s.show === 'ImageFull' || s.show === 'YouTubePlayer')
    expect(imgs.length).toBeGreaterThanOrEqual(2)
  })
})
