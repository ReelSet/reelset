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
  CONTENT_TOP,
  LOW_BOTTOM,
  LOW_TOP,
  ZONE_BOTTOM,
  ZONE_H,
  TOP_SAFE,
  W,
  BOTTOM_LIMIT,
  CHROME_BOTTOM,
  PANEL_TOP,
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

  it('keeps primary content above the band and a strip below it', () => {
    expect(CONTENT_TOP + ZONE_H).toBe(ZONE_BOTTOM)
    expect(ZONE_BOTTOM).toBeLessThan(CAPTION_TOP)
    expect(LOW_TOP).toBeGreaterThan(CAPTION_TOP + CAPTION_H)
    expect(LOW_BOTTOM).toBeLessThanOrEqual(H * 0.82 + 1)
    expect(ZONE_H).toBeGreaterThan(650)
  })
})

describe('top chrome layout', () => {
  it('starts at or below 12% of the frame height', () => {
    expect(TOP_SAFE / H).toBeGreaterThanOrEqual(0.12)
    expect(SAFE.top).toBe(TOP_SAFE)
  })

  it('puts content below the chrome and above the caption band', () => {
    expect(CONTENT_TOP).toBeGreaterThanOrEqual(TOP_SAFE + HEADER_H)
    expect(TOP_SAFE + HEADER_H).toBeLessThan(CAPTION_TOP)
  })

  it('is 1080x1920', () => {
    expect([W, H]).toEqual([1080, 1920])
  })
})

describe('safe zones', () => {
  it('keeps burned content inside x in [11%, 86%] and above the bottom 12%', () => {
    expect(SAFE.left).toBeGreaterThanOrEqual(W * 0.11)
    expect(W - SAFE.right).toBeLessThanOrEqual(W * 0.86)
    expect(BOTTOM_LIMIT).toBeLessThanOrEqual(H * 0.88)
    expect(LOW_BOTTOM).toBeLessThanOrEqual(BOTTOM_LIMIT)
  })

  it('starts every screen below the top chrome', () => {
    expect(PANEL_TOP).toBeGreaterThan(CHROME_BOTTOM)
    expect(CONTENT_TOP).toBeGreaterThan(PANEL_TOP)
  })
})

describe('code card and bar value layout', () => {
  it('stacks the tags of a one-line DNS record', async () => {
    const { cardLines } = await import('./looks')
    expect(cardLines('v=DMARC1; p=none;', 'dns')).toEqual(['v=DMARC1;', 'p=none;'])
    expect(cardLines('npm i x', 'bash')).toEqual(['npm i x'])
    expect(cardLines('a=1; b=2; c=3; d=4; e=5;', 'dns')).toEqual(['a=1; b=2; c=3; d=4; e=5;'])
  })

  it('sizes the bar value column for the longest value on one line', async () => {
    const { barValueWidth } = await import('./looks')
    expect(barValueWidth(['49 min', '~20 min'])).toBeGreaterThanOrEqual(7 * 84 * 0.6)
    expect(barValueWidth(['9%'])).toBe(220)
    expect(barValueWidth(['1,234,567,890 tokens'])).toBe(420)
  })
})
