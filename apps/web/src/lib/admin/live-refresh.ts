import type { ItemDrawerData } from './drawer-types'

export const AUTO_REFRESH_MS = 30_000
export const DRAWER_LIVE_REFRESH_MS = 30_000
/** No pointer or key input for this long pauses auto refresh until the admin is back. */
export const IDLE_AFTER_MS = 5 * 60_000

const SETTLED_ITEM = new Set(['rendered', 'failed', 'insufficient_source', 'source_only'])
const ACTIVE_RENDER = new Set(['queued', 'rendering'])

export function shouldAutoRefresh(input: {
  paused: boolean
  hidden: boolean
  lastInputAt: number
  now: number
}): boolean {
  return !input.paused && !input.hidden && input.now - input.lastInputAt < IDLE_AFTER_MS
}

/** An item drawer keeps polling only while the pipeline may still change what it shows. */
export function itemDrawerIsLive(data: ItemDrawerData | undefined): boolean {
  if (!data) return true
  if (data.renders.some((r) => ACTIVE_RENDER.has(r.status))) return true
  if (data.item.visibility === 'hidden') return false
  return !SETTLED_ITEM.has(data.item.status)
}
