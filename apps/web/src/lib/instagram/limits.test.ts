import * as core from '@reelset/core'
import { describe, expect, it } from 'vitest'
import { INSTAGRAM_CAPTION_MAX_CHARS, INSTAGRAM_HASHTAG_MAX } from './limits'

describe('instagram limits', () => {
  it('match the core constants', () => {
    expect(INSTAGRAM_CAPTION_MAX_CHARS).toBe(core.INSTAGRAM_CAPTION_MAX_CHARS)
    expect(INSTAGRAM_HASHTAG_MAX).toBe(core.INSTAGRAM_HASHTAG_MAX)
  })
})
