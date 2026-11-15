import {
  HIDDEN_REASONS,
  HIDDEN_REASON_LABELS,
  ITEM_VISIBILITIES,
  parseVisibility,
} from '@reelset/core'
import { describe, expect, it } from 'vitest'
import * as local from './hidden-reasons'

describe('client-safe copy of the moderation constants', () => {
  it('matches core so the two cannot drift', () => {
    expect(local.HIDDEN_REASONS).toEqual(HIDDEN_REASONS)
    expect(local.HIDDEN_REASON_LABELS).toEqual(HIDDEN_REASON_LABELS)
    for (const value of [...ITEM_VISIBILITIES, 'weird', '']) {
      expect(local.parseVisibilityValue(value)).toBe(parseVisibility(value))
    }
  })
})
