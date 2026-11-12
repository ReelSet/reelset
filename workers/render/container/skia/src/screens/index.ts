import type { ScreenName } from '../plan'
import { EndCard, ImageFull, KeyPoint, StatSlam, fallback } from './core'
import type { Screen } from './types'

export { fallback }

/** Screens by planner name. Missing names draw `fallback`. */
export const SCREENS: Partial<Record<ScreenName, Screen>> = {
  KeyPoint,
  StatSlam,
  ImageFull,
  EndCard,
}
