import { describe, expect, it } from 'vitest'
import { ItemStatus } from '../db/enums'
import {
  InvalidTransitionError,
  PIPELINE_STAGES,
  SETTLED_ITEM_STATUSES,
  UNHEALTHY_ITEM_STATUSES,
  assertTransition,
  canTransition,
  isSettledStatus,
  isVisibleInFeed,
  nextStage,
} from './item-status'

const ALL = Object.values(ItemStatus)

describe('item status machine', () => {
  it('walks the happy path stage by stage', () => {
    for (let i = 0; i < PIPELINE_STAGES.length - 1; i++) {
      const from = PIPELINE_STAGES[i]!
      const to = PIPELINE_STAGES[i + 1]!
      expect(canTransition(from, to)).toBe(true)
      expect(nextStage(from)).toBe(to)
    }
    expect(nextStage('rendered')).toBeNull()
  })

  it('never skips a stage forward', () => {
    expect(canTransition('found', 'embedded')).toBe(false)
    expect(canTransition('summarized', 'rendered')).toBe(false)
    expect(canTransition('found', 'rendered')).toBe(false)
  })

  it('lets every in-flight stage fail, but not rendered, insufficient_source or source_only', () => {
    for (const stage of ['found', 'summarized', 'embedded', 'voiced'] as const) {
      expect(canTransition(stage, 'failed')).toBe(true)
    }
    expect(canTransition('rendered', 'failed')).toBe(false)
    expect(canTransition('insufficient_source', 'failed')).toBe(false)
    expect(canTransition('source_only', 'failed')).toBe(false)
  })

  it('only marks insufficient_source straight from found (no transcript, no reel)', () => {
    for (const from of ALL) {
      expect(canTransition(from, 'insufficient_source')).toBe(from === 'found')
    }
  })

  it('only marks source_only straight from found, before any script is written', () => {
    for (const from of ALL) {
      expect(canTransition(from, 'source_only')).toBe(from === 'found')
    }
  })

  it('lets an admin send a source_only item back to found, and nowhere else', () => {
    for (const to of ALL) {
      expect(canTransition('source_only', to)).toBe(to === 'found')
    }
    expect(() => assertTransition('source_only', 'summarized')).toThrow(InvalidTransitionError)
  })

  it('allows admin retry from failed back to any pipeline stage except rendered', () => {
    for (const stage of ['found', 'summarized', 'embedded', 'voiced'] as const) {
      expect(canTransition('failed', stage)).toBe(true)
    }
    expect(canTransition('failed', 'rendered')).toBe(false)
    expect(canTransition('insufficient_source', 'found')).toBe(true)
  })

  it('rejects self transitions', () => {
    for (const status of ALL) expect(canTransition(status, status)).toBe(false)
  })

  it('assertTransition throws a typed error carrying both ends', () => {
    expect(() => assertTransition('found', 'voiced')).toThrow(InvalidTransitionError)
    try {
      assertTransition('found', 'voiced')
    } catch (err) {
      expect(err).toMatchObject({ from: 'found', to: 'voiced' })
    }
  })

  it('shows only rendered items in the feed', () => {
    for (const status of ALL) expect(isVisibleInFeed(status)).toBe(status === 'rendered')
  })

  it('has no next stage for off-pipeline statuses', () => {
    expect(nextStage('failed')).toBeNull()
    expect(nextStage('insufficient_source')).toBeNull()
    expect(nextStage('source_only')).toBeNull()
  })

  it('treats source_only as settled and healthy: not in flight, not an error', () => {
    expect(isSettledStatus('source_only')).toBe(true)
    expect(UNHEALTHY_ITEM_STATUSES).not.toContain('source_only')
    expect(PIPELINE_STAGES).not.toContain('source_only')
    expect([...UNHEALTHY_ITEM_STATUSES].sort()).toEqual(['failed', 'insufficient_source'])
  })

  it('splits every status into in flight or settled', () => {
    for (const status of ALL) {
      const inFlight = nextStage(status) !== null
      expect(isSettledStatus(status)).toBe(!inFlight)
    }
    for (const status of UNHEALTHY_ITEM_STATUSES) expect(SETTLED_ITEM_STATUSES).toContain(status)
  })
})
