import { describe, expect, it } from 'vitest'
import { toFrames, totalFrames } from './timeline'
import type { Scene } from './types'

const scenes: Scene[] = [
  { kind: 'hook', start: 0, end: 2, text: 'hook' },
  { kind: 'beat', start: 2, end: 5.5, text: 'a', visual: { type: 'title', title: 'A' } },
  { kind: 'outro', start: 5.5, end: 8, text: 'bye' },
]

describe('toFrames', () => {
  it('maps spoken scene starts to contiguous frame ranges', () => {
    const total = totalFrames(8, 30)
    const timed = toFrames(scenes, 30, total)
    expect(timed.map((s) => [s.from, s.frames])).toEqual([
      [0, 60],
      [60, 105],
      [165, 75],
    ])
    expect(timed.reduce((n, s) => n + s.frames, 0)).toBe(total)
  })

  it('never lets a scene start past the end or have zero frames', () => {
    const timed = toFrames(
      [
        { kind: 'hook', start: 0, end: 1, text: 'h' },
        { kind: 'outro', start: 9, end: 9.2, text: 'o' },
      ],
      30,
      30,
    )
    expect(timed[1]?.from).toBe(29)
    expect(timed.every((s) => s.frames >= 1)).toBe(true)
  })
})
