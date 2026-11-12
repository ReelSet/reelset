import { describe, expect, it } from 'vitest'
import { capEndCard, limitPlates, MAX_PLATES, isPlated } from './plates'
import { fillShare, MIN_FILL } from './fill'
import type { TimedShot } from './types'

const kp = (text: string, props: Record<string, unknown> = {}): TimedShot => ({
  from: 0,
  frames: 60,
  show: 'KeyPoint',
  props: { text, sub: '', ...props },
  sceneIndex: 1,
  origin: 'planned',
})
const stat: TimedShot = {
  from: 0,
  frames: 60,
  show: 'StatSlam',
  props: { value: '521', label: 'points on Hacker News', proof: true },
  sceneIndex: 0,
  origin: 'planned',
}

describe('limitPlates', () => {
  const texts = [
    'Fix it with one DNS record',
    'Small senders get hit first',
    'Check DMARC alignment',
    'Reject policy is next',
  ]

  it('keeps the source plate on the first cards only; the rest go bare and still fill the frame', () => {
    const out = limitPlates(texts.map((t) => kp(t)))
    expect(out.slice(0, MAX_PLATES).every((s) => !s.props.bare)).toBe(true)
    for (const s of out.slice(MAX_PLATES)) {
      expect(s.props.bare).toBe(true)
      expect(fillShare(s)).toBeGreaterThanOrEqual(MIN_FILL)
    }
  })

  it('shows the big count once: never after a hook that opened on it, once on the first plate otherwise', () => {
    const afterHook = limitPlates([stat, kp(texts[0]!), kp(texts[1]!)])
    expect(afterHook.slice(1).every((s) => s.props.noCount === true)).toBe(true)
    const plain = limitPlates([kp(texts[0]!), kp(texts[1]!)])
    expect(plain[0]!.props.noCount).toBeUndefined()
    expect(plain[1]!.props.noCount).toBe(true)
  })

  it('leaves footage, lists, quotes and hooks alone', () => {
    const others = [
      kp('Over footage', { bg: 2 }),
      kp('', { items: ['SPF', 'DKIM'] }),
      kp('Said by a user', { quote: 'x' }),
      kp('Hook headline', { hook: true }),
    ]
    expect(others.every((s) => !isPlated(s))).toBe(true)
    expect(limitPlates([...others, ...others, ...others])).toEqual([
      ...others,
      ...others,
      ...others,
    ])
  })

  it('keeps the plate when a bare card would leave the frame empty', () => {
    const out = limitPlates([kp('a'), kp('b'), kp('Hi')])
    expect(out[2]!.props.bare).toBeUndefined()
  })
})

describe('capEndCard', () => {
  const at = (show: TimedShot['show'], from: number, frames: number): TimedShot => ({
    from,
    frames,
    show,
    props: {},
    sceneIndex: 1,
    origin: 'planned',
  })

  it('moves end card time over 3 s to the shot before it, up to its own 4 s', () => {
    const out = capEndCard([at('KeyPoint', 0, 60), at('EndCard', 60, 150)], 30)
    expect(out[0]!.frames).toBe(120)
    expect(out[1]).toMatchObject({ from: 120, frames: 90 })
  })

  it('never makes the shot before it longer than 4 s, and keeps the total', () => {
    const out = capEndCard([at('KeyPoint', 0, 110), at('EndCard', 110, 150)], 30)
    expect(out[0]!.frames).toBe(120)
    expect(out[0]!.frames + out[1]!.frames).toBe(260)
    expect(capEndCard([at('KeyPoint', 0, 120), at('EndCard', 120, 150)], 30)[1]!.frames).toBe(150)
  })
})
