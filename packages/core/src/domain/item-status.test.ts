import { describe, expect, it } from 'vitest'
import { ItemStatus } from '../db/enums'
import {
  InvalidTransitionError,
  PIPELINE_STAGES,
  assertTransition,
  canTransition,
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

  it('lets every in-flight stage fail, but not rendered or insufficient_source', () => {
    for (const stage of ['found', 'summarized', 'embedded', 'voiced'] as const) {
      expect(canTransition(stage, 'failed')).toBe(true)
    }
    expect(canTransition('rendered', 'failed')).toBe(false)
    expect(canTransition('insufficient_source', 'failed')).toBe(false)
  })

  it('only marks insufficient_source straight from found (no transcript, no reel)', () => {
    for (const from of ALL) {
      expect(canTransition(from, 'insufficient_source')).toBe(from === 'found')
    }
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
  })
})
