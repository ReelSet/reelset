import { HEADER_H, TOP_SAFE } from '../theme'

export const PUNCH_SCALE = 1.06

/**
 * Pushed in from the bottom of the top chrome: `Page` content already drifts up toward the chrome
 * (Drift scales from the frame centre), so the punch only grows content downward, into the gap
 * above the centred captions.
 */
export const PUNCH_ORIGIN_Y = TOP_SAFE + HEADER_H

/** Where a point at `y` lands after the punch-in. */
export const punchedY = (y: number): number => PUNCH_ORIGIN_Y + (y - PUNCH_ORIGIN_Y) * PUNCH_SCALE

/** CSS transform-origin; right-hanging content pushes in from the right so its edge stays in. */
export const punchOrigin = (rightAligned: boolean): string =>
  `${rightAligned ? 88 : 5}% ${PUNCH_ORIGIN_Y}px`
