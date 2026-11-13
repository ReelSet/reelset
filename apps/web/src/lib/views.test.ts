import { describe, expect, it } from 'vitest'
import {
  MAX_VIEWS_PER_BATCH,
  VIEWS_PER_VIEWER_PER_HOUR,
  parseViewBody,
  viewAllowance,
  viewerKey,
} from './views'

const A = '3f2b8d1e-5c4a-4e6f-9a1b-2c3d4e5f6a7b'
const B = '4f2b8d1e-5c4a-4e6f-9a1b-2c3d4e5f6a7c'

describe('parseViewBody', () => {
  it('accepts a batch and dedupes ids', () => {
    expect(parseViewBody(JSON.stringify({ itemIds: [A, B, A.toUpperCase()] }))).toEqual({
      ok: true,
      itemIds: [A, B],
    })
  })

  it('rejects bad json, bad ids, empty and oversized batches', () => {
    expect(parseViewBody('nope')).toEqual({ ok: false, reason: 'not_json' })
    expect(parseViewBody(JSON.stringify({ itemIds: ['x'] }))).toEqual({
      ok: false,
      reason: 'invalid',
    })
    expect(parseViewBody(JSON.stringify({ itemIds: [] })).ok).toBe(false)
    const many = Array.from(
      { length: MAX_VIEWS_PER_BATCH + 1 },
      (_, i) => `4f2b8d1e-5c4a-4e6f-9a1b-2c3d4e5f6a${String(i).padStart(2, '0')}`,
    )
    expect(parseViewBody(JSON.stringify({ itemIds: many })).ok).toBe(false)
    expect(parseViewBody(' '.repeat(5000))).toEqual({ ok: false, reason: 'too_large' })
  })
})

describe('viewAllowance', () => {
  it('lets everything through under the cap', () => {
    expect(viewAllowance(0, 5)).toBe(5)
  })

  it('trims to the remaining allowance and never goes negative', () => {
    expect(viewAllowance(VIEWS_PER_VIEWER_PER_HOUR - 2, 5)).toBe(2)
    expect(viewAllowance(VIEWS_PER_VIEWER_PER_HOUR + 10, 5)).toBe(0)
  })
})

describe('viewerKey', () => {
  it('prefers the account over the session', () => {
    expect(viewerKey('p1', 's1')).toBe('u:p1')
    expect(viewerKey(null, 's1')).toBe('s:s1')
  })
})
