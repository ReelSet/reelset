import { describe, expect, it } from 'vitest'
import {
  CAPTION_FONT,
  CAPTION_H,
  CAPTION_LINE_HEIGHT,
  CAPTION_MAX_LINES,
  CAPTION_TOP,
  CONTENT_TOP,
  H,
  HEADER_H,
  TOP_SAFE,
  ZONE_BOTTOM,
} from '../theme'
import { PUNCH_ORIGIN_Y, punchedY, punchOrigin } from './punch'

const drifted = (y: number) => H / 2 + (y - H / 2) * 1.045
const captionTextTop =
  CAPTION_TOP + (CAPTION_H - CAPTION_MAX_LINES * CAPTION_FONT * CAPTION_LINE_HEIGHT) / 2

describe('punch-in framing', () => {
  it('never pushes drifted content under the top chrome', () => {
    expect(punchedY(drifted(CONTENT_TOP))).toBeGreaterThanOrEqual(TOP_SAFE + HEADER_H)
  })

  it('keeps the bottom of the drifted content zone above a two-line caption', () => {
    expect(punchedY(drifted(ZONE_BOTTOM))).toBeLessThan(captionTextTop - 8)
  })

  it('anchors at the chrome edge on the side the content hangs on', () => {
    expect(punchOrigin(false)).toBe(`5% ${PUNCH_ORIGIN_Y}px`)
    expect(punchOrigin(true)).toBe(`88% ${PUNCH_ORIGIN_Y}px`)
  })
})
