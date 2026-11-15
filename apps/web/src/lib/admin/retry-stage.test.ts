import { ItemStatus } from '@reelset/core'
import { describe, expect, it } from 'vitest'
import { RETRY_STAGES } from './retry'
import { suggestRetryStage } from './retry-stage'

describe('suggestRetryStage (client-safe copy)', () => {
  it('uses the same stage names as core', () => {
    expect(RETRY_STAGES.map(suggestRetryStage)).toEqual([...RETRY_STAGES])
    expect(suggestRetryStage(ItemStatus.voiced)).toBe(ItemStatus.embedded)
  })

  it('falls back to the first stage for unknown or missing values', () => {
    expect(suggestRetryStage(null)).toBe(ItemStatus.found)
    expect(suggestRetryStage('nonsense')).toBe(ItemStatus.found)
  })
})
