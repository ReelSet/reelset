import { describe, expect, it } from 'vitest'
import { PLATE_H, SAFE_H, fillShare, plateFact, sparseShots, textPlan } from './fill'
import type { TimedShot } from './types'

const kp = (props: Record<string, unknown>, frames = 90): TimedShot =>
  ({ from: 0, frames, show: 'KeyPoint', props, sceneIndex: 0, origin: 'planned' }) as TimedShot

describe('fillShare', () => {
  it('counts footage, hooks, lists and quotes as filled', () => {
    expect(fillShare(kp({ text: 'x y', bg: 1 }))).toBe(1)
    expect(fillShare(kp({ text: 'X Y', hook: true }))).toBe(1)
    expect(fillShare(kp({ items: ['a', 'b'] }))).toBeGreaterThanOrEqual(0.5)
    expect(fillShare({ show: 'StatSlam', props: {} })).toBe(1)
  })

  it('counts a statement as its text, the context plate and the caption band', () => {
    const share = fillShare(kp({ text: 'Experts guide the student' }))
    expect(share).toBeGreaterThanOrEqual(0.5)
    expect(share).toBeLessThanOrEqual(1)
    const { blockPx } = textPlan('Experts guide the student', '', 0)
    expect(blockPx + PLATE_H).toBeLessThan(SAFE_H)
  })

  it('lets a text-less shot without footage carry its own full plate', () => {
    expect(fillShare(kp({ text: '' }))).toBeGreaterThanOrEqual(0.5)
  })
})

describe('textPlan', () => {
  it('sets short statements large and leaves room for the plate', () => {
    const short = textPlan('Heavy pipeline', '', 0)
    const long = textPlan('Training a LoRA now takes about twenty minutes on one card', '', 0)
    expect(short.size).toBeGreaterThan(long.size)
    expect(short.size).toBeGreaterThanOrEqual(110)
    expect(long.blockPx + short.plateH).toBeLessThanOrEqual(742)
  })
})

describe('sparseShots', () => {
  it('flags a screen that stays mostly empty past 1.5 s', () => {
    const empty = kp({ text: '' })
    expect(sparseShots([empty], 30)).toEqual([])
    const tiny = kp({ items: [] }, 120)
    expect(sparseShots([tiny], 30).length).toBeLessThanOrEqual(1)
  })
})

describe('plateFact', () => {
  it('shows a real count only', () => {
    expect(plateFact('github', { repo: { stars: 1240 } })).toEqual({
      value: '1.2k',
      label: 'stars',
    })
    expect(plateFact('hn', { hn: { points: 521 } })).toEqual({ value: '521', label: 'points' })
    expect(plateFact('github', {})).toBeNull()
    expect(plateFact('news', {})).toBeNull()
  })
})
