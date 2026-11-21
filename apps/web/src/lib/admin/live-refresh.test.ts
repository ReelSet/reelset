import { describe, expect, it } from 'vitest'
import type { ItemDrawerData } from './drawer-types'
import { IDLE_AFTER_MS, itemDrawerIsLive, shouldAutoRefresh } from './live-refresh'

function drawer(status: string, renders: string[] = [], visibility = 'public'): ItemDrawerData {
  return {
    item: { status, visibility },
    renders: renders.map((s) => ({ status: s })),
  } as unknown as ItemDrawerData
}

describe('shouldAutoRefresh', () => {
  const now = 1_000_000_000
  it('refreshes a visible, recently used page', () => {
    expect(shouldAutoRefresh({ paused: false, hidden: false, lastInputAt: now - 1000, now })).toBe(
      true,
    )
  })

  it('stops when paused, hidden or idle', () => {
    const base = { paused: false, hidden: false, lastInputAt: now, now }
    expect(shouldAutoRefresh({ ...base, paused: true })).toBe(false)
    expect(shouldAutoRefresh({ ...base, hidden: true })).toBe(false)
    expect(shouldAutoRefresh({ ...base, lastInputAt: now - IDLE_AFTER_MS })).toBe(false)
  })
})

describe('itemDrawerIsLive', () => {
  it('polls until data arrives and while the item is in the pipeline', () => {
    expect(itemDrawerIsLive(undefined)).toBe(true)
    expect(itemDrawerIsLive(drawer('found'))).toBe(true)
    expect(itemDrawerIsLive(drawer('voiced'))).toBe(true)
  })

  it('stops on settled or hidden items', () => {
    for (const status of ['rendered', 'failed', 'insufficient_source', 'source_only']) {
      expect(itemDrawerIsLive(drawer(status, ['done']))).toBe(false)
    }
    expect(itemDrawerIsLive(drawer('voiced', [], 'hidden'))).toBe(false)
  })

  it('keeps polling a settled item while a re-render runs', () => {
    expect(itemDrawerIsLive(drawer('rendered', ['queued', 'done']))).toBe(true)
    expect(itemDrawerIsLive(drawer('rendered', ['rendering']))).toBe(true)
  })
})
