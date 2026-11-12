import { describe, expect, it } from 'vitest'
import { GRADES, normalizeScenes } from './scenes'

const fn = () => {}
const scene = (t0: number, extra: Record<string, unknown> = {}) => ({ t0, fn, ...extra })

describe('normalizeScenes', () => {
  it('sorts scenes and makes them contiguous from 0 to the duration', () => {
    const out = normalizeScenes([scene(4.2), scene(0.3), scene(2.1)], 10, 0)
    expect(out.map((s) => [s.t0, s.t1])).toEqual([
      [0, 2.1],
      [2.1, 4.2],
      [4.2, 10],
    ])
  })

  it('drops scenes without a function, with a bad start or past the end', () => {
    const out = normalizeScenes(
      [
        scene(0),
        { t0: 1 },
        scene(Number.NaN),
        scene('2' as unknown as number),
        scene(10.5),
        scene(3),
      ],
      10,
      0,
    )
    expect(out.map((s) => s.t0)).toEqual([0, 3])
  })

  it('drops scenes that would last under 0.1 s', () => {
    const out = normalizeScenes([scene(0), scene(2), scene(2.05), scene(5)], 8, 0)
    expect(out.map((s) => s.t0)).toEqual([0, 2, 5])
  })

  it('maps tone, captions and the up exit', () => {
    const [a, b, c] = normalizeScenes(
      [scene(0, { tone: 'bone', cap: false }), scene(1, { tone: 'lime', exit: 'up' }), scene(2)],
      4,
      0,
    )
    expect([a!.tone, a!.cap, a!.exit]).toEqual(['light', false, null])
    expect([b!.tone, b!.cap, b!.exit]).toEqual(['lime', true, 'up'])
    expect([c!.tone, c!.exit]).toEqual(['dark', null])
  })

  it('maps clips to valid broll indexes and grades to ffmpeg filters', () => {
    const out = normalizeScenes(
      [
        scene(0, { vid: { clip: 1, grade: 'lime' } }),
        scene(1, { vid: { clip: 7, grade: 'nonsense' } }),
        scene(2, { vid: { clip: 0, grade: 'none' } }),
        scene(3, { vid: null }),
      ],
      5,
      2,
    )
    expect(out.map((s) => s.clip)).toEqual([1, null, 0, null])
    expect(out[0]!.grade).toBe(GRADES.lime)
    expect(out[1]!.grade).toBe(GRADES.dim)
    expect(out[2]!.grade).toBe('null')
  })

  it('throws when nothing usable is returned', () => {
    expect(() => normalizeScenes('nope', 5, 0)).toThrow(/array/)
    expect(() => normalizeScenes([], 5, 0)).toThrow(/no usable scenes/)
    expect(() => normalizeScenes([{ t0: 0 }], 5, 0)).toThrow(/no usable scenes/)
  })
})
