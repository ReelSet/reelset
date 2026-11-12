import { describe, expect, it } from 'vitest'
import { DEMO_MIN_HEIGHT_SHARE, demoLayout, demoSpan } from './demo'
import { CONTENT_W, H, SAFE, W } from '../theme'

const wide = { width: 1280, height: 720 }

describe('demoLayout', () => {
  it('fills at least 60% of the frame height inside the safe box', () => {
    const l = demoLayout(wide)
    expect(l.height / H).toBeGreaterThanOrEqual(DEMO_MIN_HEIGHT_SHARE)
    expect(l.left).toBeGreaterThanOrEqual(Math.floor(W * 0.11))
    expect(l.left + l.width).toBeLessThanOrEqual(W - SAFE.right)
    expect(l.width).toBe(CONTENT_W)
    for (const part of l.parts) {
      expect(part.videoHeight).toBeGreaterThanOrEqual(l.height)
      expect(part.videoWidth).toBeGreaterThanOrEqual(l.width)
    }
  })

  it('starts the first cut at the left edge of the content, so a heading is never cut at its start', () => {
    const l = demoLayout({ ...wide, content: { x0: 0.057, x1: 0.92 } })
    const start = demoSpan(l.parts[0], l.width, 0)
    expect(start.x0).toBeLessThanOrEqual(0.057 + 0.001)
    expect(start.x0).toBeGreaterThanOrEqual(0.057 - 0.001)
  })

  it('never pans past the clip or outside its content window', () => {
    const l = demoLayout({ ...wide, content: { x0: 0.057, x1: 0.92 }, focus: { x: 0.5, y: 0.17 } })
    for (const part of l.parts) {
      for (const p of [0, 0.5, 1]) {
        const span = demoSpan(part, l.width, p)
        expect(span.x0).toBeGreaterThanOrEqual(-1e-9)
        expect(span.x1).toBeLessThanOrEqual(1 + 1e-9)
      }
    }
    // The first cut stays where its heading starts: it never pans.
    expect(l.parts[0].from).toEqual(l.parts[0].to)
  })

  it('zooms the second cut closer on the densest region', () => {
    const l = demoLayout({ ...wide, focus: { x: 0.7, y: 0.3 } })
    expect(l.parts[1].videoWidth).toBeGreaterThan(l.parts[0].videoWidth)
    const s = demoLayout({ ...wide, static: true, focus: { x: 0.7, y: 0.3 } })
    const span = demoSpan(s.parts[1], s.width, 0)
    expect((span.x0 + span.x1) / 2).toBeGreaterThan(0.5)
    // A moving demo keeps both cuts starting at its heading.
    expect(demoSpan(l.parts[1], l.width, 0).x0).toBeCloseTo(demoSpan(l.parts[0], l.width, 0).x0, 1)
  })

  it('does not pan a static demo and zooms both cuts into its text', () => {
    const l = demoLayout({ ...wide, static: true, focus: { x: 0.5, y: 0.2 } })
    expect(l.parts[0].from).toEqual(l.parts[0].to)
    expect(l.parts[0].videoWidth).toBeGreaterThan(Math.round(1280 * (l.height / 720)))
  })

  it('fills the window with a portrait clip too', () => {
    const l = demoLayout({ width: 720, height: 1280 })
    expect(l.parts[0].videoWidth).toBeGreaterThanOrEqual(l.width)
    expect(l.parts[0].videoHeight).toBeGreaterThanOrEqual(l.height)
  })
})
