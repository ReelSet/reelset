import { describe, expect, it } from 'vitest'
import { lookKey } from './finalize'
import { assignBroll } from './broll'
import { sampleReel } from './fixtures'
import { capFor, identityOf, imageIndex, newState, pickShot, varietyKey } from './planner'
import { enforceVariety } from './variety'
import { resolveShots, totalFrames, withDemoOffsets } from './timeline'
import type { BrollClip, ReelProps, Scene, TimedShot } from './types'

const FPS = 30
const run = (p: ReelProps) => resolveShots(p, FPS, totalFrames(p.durationSeconds, FPS)).shots
const clip = (n: number): BrollClip => ({ src: `job/b${n}.mp4`, seconds: 5, beat: n })
const images = [
  { src: 'job/i0.jpg', kind: 'thumbnail' as const, width: 1280, height: 720 },
  { src: 'job/i5.jpg', kind: 'og' as const, width: 1200, height: 630 },
  { src: 'job/i1.jpg', kind: 'og' as const, width: 1280, height: 640 },
  { src: 'job/i2.jpg', kind: 'figure' as const, width: 800, height: 600, alt: 'Figure 1: a' },
  { src: 'job/i3.jpg', kind: 'figure' as const, width: 900, height: 600, alt: 'Figure 2: b' },
  { src: 'job/i4.jpg', kind: 'screenshot' as const, width: 1280, height: 800 },
]

const count = (shots: TimedShot[], key: (s: TimedShot) => string) => {
  const m = new Map<string, number>()
  for (const s of shots) m.set(key(s), (m.get(key(s)) ?? 0) + 1)
  return m
}

describe('planner variety', () => {
  const p = sampleReel({ source: 'news', images, broll: [1, 2, 3, 4, 5, 6, 7, 8].map(clip) })
  const shots = run(p)

  it('keeps every screen look near its cap and EndCard at one when options run short', () => {
    for (const [k, n] of count(shots, (s) => varietyKey(s.show, s.props))) {
      expect(n, k).toBeLessThanOrEqual(4)
    }
    expect(shots.filter((s) => s.show === 'EndCard')).toHaveLength(1)
  })

  it('shows the same image at most twice (a figure three times, each a different crop)', () => {
    const img = new Set(['ImageFull', 'FigureZoom', 'YouTubePlayer', 'ArticleHeadline'])
    const uses = count(
      shots.filter((s) => img.has(s.show)),
      (s) => String(imageIndex(s.props)),
    )
    for (const [i, n] of uses)
      expect(n).toBeLessThanOrEqual(images[Number(i)]!.kind === 'figure' ? 3 : 2)
  })

  it('never shows the same look twice in a row (only key points may follow each other)', () => {
    shots.forEach((s, i) => {
      const prev = shots[i - 1]
      if (!prev) return
      if (s.show !== 'KeyPoint') expect(s.show).not.toBe(prev.show)
      expect(s.props.alt).toBeUndefined()
      expect(lookKey(s)).not.toBe(lookKey(prev))
    })
  })

  it('caps an LLM that cues the same screen over and over', () => {
    const q = sampleReel({ source: 'papers', images, broll: [1, 2, 3, 4, 5, 6].map(clip) })
    q.scenes = q.scenes.map((sc: Scene) => {
      if (sc.kind !== 'beat') return sc
      const words = sc.text.split(' ')
      return {
        ...sc,
        shots: [0, 5, 10, 15].map((k) => ({
          at: words[k]!.replace(/\W/g, '') || 'the',
          show: 'PaperPage' as const,
        })),
      }
    })
    expect(run(q).filter((s) => s.show === 'PaperPage').length).toBeLessThanOrEqual(3)
  })

  it('is deterministic with b-roll', () => {
    expect(run(p)).toEqual(run(p))
  })
})

describe('pickShot caps', () => {
  const ctx = (p: ReelProps) => ({ props: p, fps: FPS })
  const chunk = { start: 8, end: 10 }

  it('skips a source card whose looks are all used while alternatives exist', () => {
    const p = sampleReel({ source: 'papers', images: [] })
    const state = newState()
    state.sourceUsed.PaperPage = ['title', 'abstract']
    const pick = pickShot(ctx(p), p.scenes[1]!, 1, chunk, false, false, 8, state)
    expect(pick.show).not.toBe('PaperPage')
  })

  it('never picks an image that has two uses', () => {
    const p = sampleReel({ images })
    const state = newState()
    state.imageUses[0] = 2
    state.imageUses[1] = 2
    for (let i = 0; i < 6; i += 1) {
      const pick = pickShot(
        ctx(p),
        p.scenes[1]!,
        1,
        { start: 8 + i, end: 10 + i },
        false,
        false,
        8 + i,
        state,
      )
      if (typeof pick.props.image === 'number') expect([0, 1]).not.toContain(pick.props.image)
      state.history.length = 0
    }
  })

  it('offers a b-roll backed KeyPoint once plain looks are used up', () => {
    const p = sampleReel({ source: 'papers', images: [], broll: [clip(1)] })
    const state = newState()
    state.uses.PaperPage = 2
    for (const style of [0, 1, 2]) state.uses[`KeyPoint/${style}`] = 2
    state.history.push('Terminal', 'StatSlam', 'Compare')
    const pick = pickShot(ctx(p), p.scenes[1]!, 1, chunk, false, false, 8, state)
    expect(pick.show === 'KeyPoint' ? pick.props.bg : 0).toBe(0)
  })
})

describe('cue stats keep their room', () => {
  it('re-picks a planned stat that would use up the cap before a cued one', () => {
    const p = sampleReel({ source: 'github', images: [], broll: [1, 2, 3, 4].map(clip) })
    const stat = (from: number, value: string, origin: TimedShot['origin']): TimedShot => ({
      from,
      frames: 60,
      show: 'StatSlam',
      props: { value, label: 'x' },
      sceneIndex: 1,
      origin,
    })
    const out = enforceVariety(
      [stat(0, '94', 'planned'), stat(60, '70', 'planned'), stat(120, '7.1', 'cue')],
      p,
      FPS,
    )
    expect(out.find((s) => s.props.value === '7.1')?.show).toBe('StatSlam')
    expect(out.filter((s) => s.show === 'StatSlam' && s.origin === 'planned').length).toBeLessThan(
      2,
    )
  })
})

describe('code identity', () => {
  it('reads one line shown as a terminal and as a code block as the same screen', () => {
    const line = '550 5.7.1 Message rejected: Message lacks SPF'
    expect(identityOf('Terminal', { lines: [line] })).toBe(
      identityOf('CodeBlock', { code: line, language: 'text' }),
    )
  })
})

describe('b-roll assignment', () => {
  const mk = (show: TimedShot['show'], sceneIndex: number, i: number): TimedShot => ({
    from: i * 60,
    frames: 60,
    show,
    props: {},
    sceneIndex,
    origin: 'planned',
  })
  const base = [
    mk('KeyPoint', 1, 0),
    mk('RepoPage', 1, 1),
    mk('StatSlam', 2, 2),
    mk('ImageFull', 2, 3),
    mk('KeyPoint', 3, 4),
    mk('EndCard', 4, 5),
  ]

  it('gives each clip to one shot, never reusing a clip, only on backdrop screens', () => {
    const out = assignBroll(base, [1, 2, 3, 4, 5, 6].map(clip))
    const bgs = out.flatMap((s) => (typeof s.props.bg === 'number' ? [s.props.bg] : []))
    expect(new Set(bgs).size).toBe(bgs.length)
    // Two clips stay free for the later passes.
    expect(bgs).toHaveLength(4)
    for (const s of out) {
      if (typeof s.props.bg === 'number') {
        expect(['KeyPoint', 'StatSlam', 'Compare', 'EndCard']).toContain(s.show)
      }
    }
  })

  it('prefers the clip made for the shot beat', () => {
    const out = assignBroll(base, [clip(9), clip(2), clip(3)])
    const stat = out.find((s) => s.show === 'StatSlam')
    if (typeof stat?.props.bg === 'number') expect(stat.props.bg).toBe(1)
  })

  it('does nothing without clips', () => {
    expect(assignBroll(base, undefined)).toBe(base)
    expect(assignBroll(base, [])).toBe(base)
  })
})

describe('repo demo', () => {
  it('opens on the demo and plays it 3-5 s in at most two cuts', () => {
    const p = sampleReel({
      demo: { src: 'job/demo.mp4', seconds: 6, width: 1280, height: 720, repo: 'a/b' },
    })
    const shots = run(p)
    const demos = shots.filter((s) => s.show === 'RepoDemo')
    expect(shots[0]!.show).toBe('RepoDemo')
    expect(demos.length).toBeLessThanOrEqual(2)
    const seconds = demos.reduce((n, s) => n + s.frames, 0) / FPS
    expect(seconds).toBeGreaterThanOrEqual(2.2)
    expect(seconds).toBeLessThanOrEqual(5)
    if (demos.length === 2) expect(demos.map((d) => d.props.part)).toEqual([0, 1])
  })

  it('continues the clip across consecutive cuts', () => {
    const mk = (from: number): TimedShot => ({
      from,
      frames: 60,
      show: 'RepoDemo',
      props: {},
      sceneIndex: 1,
      origin: 'planned',
    })
    const out = withDemoOffsets([mk(0), mk(60)], 5, FPS)
    expect(out[0]!.props.offset).toBe(0)
    expect(out[1]!.props.offset).toBe(2)
  })

  it('never plans a demo when there is none', () => {
    expect(run(sampleReel()).some((s) => s.show === 'RepoDemo')).toBe(false)
  })
})
