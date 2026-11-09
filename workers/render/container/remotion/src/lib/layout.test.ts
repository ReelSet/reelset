import { describe, expect, it } from 'vitest'
import {
  CAPTION_FONT,
  CAPTION_H,
  CAPTION_LEFT,
  CAPTION_LINE_HEIGHT,
  CAPTION_MAX_LINES,
  CAPTION_TOP,
  CAPTION_W,
  H,
  HEADER_H,
  SAFE,
  SCENE_BOTTOM,
  SCENE_H,
  SCENE_TOP,
  TOP_SAFE,
  W,
} from '../theme'

describe('caption band layout', () => {
  it('sits at 58-72% of the frame height, above the app bottom overlay', () => {
    expect(CAPTION_TOP / H).toBeCloseTo(0.58, 2)
    expect((CAPTION_TOP + CAPTION_H) / H).toBeCloseTo(0.72, 2)
    expect(CAPTION_TOP + CAPTION_H).toBeLessThanOrEqual(H * 0.82)
  })

  it('is horizontally centered, inside 14%-86% of the width', () => {
    expect(CAPTION_W).toBeLessThanOrEqual(W * 0.72)
    expect(CAPTION_LEFT).toBeGreaterThanOrEqual(W * 0.14 - 1)
    expect(CAPTION_LEFT + CAPTION_W).toBeLessThanOrEqual(W * 0.86 + 1)
    expect(CAPTION_LEFT * 2 + CAPTION_W).toBe(W)
  })

  it('fits two lines of text', () => {
    expect(CAPTION_FONT * CAPTION_LINE_HEIGHT * CAPTION_MAX_LINES).toBeLessThanOrEqual(CAPTION_H)
  })

  it('keeps scene content above the band', () => {
    expect(SCENE_TOP + SCENE_H).toBe(SCENE_BOTTOM)
    expect(SCENE_BOTTOM).toBeLessThan(CAPTION_TOP)
    expect(SCENE_H).toBeGreaterThan(450)
  })
})

describe('top chrome layout', () => {
  it('starts at or below 12% of the frame height', () => {
    expect(TOP_SAFE / H).toBeGreaterThanOrEqual(0.12)
    expect(SAFE.top).toBe(TOP_SAFE)
  })

  it('leaves scenes between the chrome and the caption band without overlap', () => {
    const chromeBottom = TOP_SAFE + HEADER_H
    expect(SCENE_TOP).toBeGreaterThanOrEqual(chromeBottom)
    expect(SCENE_BOTTOM).toBeLessThan(CAPTION_TOP)
    expect(chromeBottom).toBeLessThan(CAPTION_TOP)
    expect(SCENE_H).toBeGreaterThanOrEqual(450)
  })
})
