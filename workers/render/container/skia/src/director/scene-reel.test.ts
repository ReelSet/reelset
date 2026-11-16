import { describe, expect, it } from 'vitest'
import type { Reel, Shot } from '../plan'
import { END_CARD_MAX_S, END_CARD_MIN_S } from '../planner/lib/plates'
import { applyScenes } from './scene-reel'
import type { Scene } from './scenes'

const shot = (show: Shot['show'], t0: number, t1: number, index: number): Shot => ({
  index,
  show,
  props: {},
  t0,
  t1,
  dur: t1 - t0,
  sceneIndex: index,
  origin: 'planned',
  topPad: 0,
  clip: null,
  enter: null,
})

const reel = (shots: Shot[], duration = 20): Reel =>
  ({ props: {}, duration, shots, headline: null }) as unknown as Reel

const scene = (t0: number, t1: number): Scene => ({
  t0,
  t1,
  fn: () => {},
  cap: true,
  tone: 'dark' as Scene['tone'],
  clip: null,
  grade: '',
  exit: null,
})

const noErrors = () => {}

describe('applyScenes', () => {
  const base = reel([shot('KeyPoint', 0, 18.5, 0), shot('EndCard', 18.5, 20, 1)])

  it('ends with the base EndCard, held between the min and max', () => {
    const out = applyScenes(base, [scene(0, 10), scene(10, 20)], noErrors)
    const last = out.shots.at(-1)!
    expect(last.show).toBe('EndCard')
    expect(last.t1).toBe(20)
    expect(last.t1 - last.t0).toBeGreaterThanOrEqual(END_CARD_MIN_S)
    expect(last.t1 - last.t0).toBeLessThanOrEqual(END_CARD_MAX_S)
    expect(out.shots.at(-2)!.t1).toBe(last.t0)
    expect(last.index).toBe(out.shots.length - 1)
  })

  it('drops a model scene that falls inside the card', () => {
    const out = applyScenes(
      base,
      [scene(0, 17.4), scene(17.4, 17.6), scene(17.6, 20)],
      noErrors,
    )
    expect(out.shots.map((s) => s.show)).toEqual(['KeyPoint', 'EndCard'])
    expect(out.shots[0]!.t1).toBe(17.5)
    expect(out.shots.map((s) => s.index)).toEqual([0, 1])
  })

  it('keeps a short scene in the middle and numbers shots in order', () => {
    const out = applyScenes(base, [scene(0, 5), scene(5, 5.3), scene(5.3, 20)], noErrors)
    expect(out.shots.map((s) => [s.t0, s.t1])).toEqual([
      [0, 5],
      [5, 5.3],
      [5.3, 17.5],
      [17.5, 20],
    ])
    expect(out.shots.map((s) => s.index)).toEqual([0, 1, 2, 3])
  })

  it('without a base EndCard is unchanged', () => {
    const out = applyScenes(reel([shot('KeyPoint', 0, 20, 0)]), [scene(0, 20)], noErrors)
    expect(out.shots).toHaveLength(1)
    expect(out.shots[0]!.t1).toBe(20)
  })
})
