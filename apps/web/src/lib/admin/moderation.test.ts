import { describe, expect, it } from 'vitest'
import {
  BULK_HIDE_LIMIT,
  formDataStrings,
  hideInputSchema,
  parseVisibilityFilter,
  unhideInputSchema,
} from './moderation'
import { safeAdminPath } from './retry'

const ID = '0b5d2f3e-6a1c-4e0b-9a55-1c2d3e4f5a6b'

describe('hideInputSchema', () => {
  it('accepts a selection with a known reason', () => {
    expect(hideInputSchema.safeParse({ itemIds: [ID], reason: 'spam' }).success).toBe(true)
  })

  it.each([
    { itemIds: [], reason: 'spam' },
    { itemIds: ['nope'], reason: 'spam' },
    { itemIds: [ID], reason: 'because' },
    { itemIds: Array(BULK_HIDE_LIMIT + 1).fill(ID), reason: 'spam' },
  ])('rejects %j', (input) => {
    expect(hideInputSchema.safeParse(input).success).toBe(false)
  })

  it('unhide needs only ids', () => {
    expect(unhideInputSchema.safeParse({ itemIds: [ID] }).success).toBe(true)
  })
})

describe('parseVisibilityFilter', () => {
  it('maps known values and ignores the rest', () => {
    expect(parseVisibilityFilter('suspected')).toBe('suspected')
    expect(parseVisibilityFilter(['hidden', 'public'])).toBe('hidden')
    expect(parseVisibilityFilter('all')).toBeNull()
    expect(parseVisibilityFilter(undefined)).toBeNull()
  })
})

describe('formDataStrings', () => {
  it('collects repeated text fields and skips files', () => {
    const form = new FormData()
    form.append('itemId', ID)
    form.append('itemId', 'b')
    form.append('itemId', new Blob(['x']))
    expect(formDataStrings(form, 'itemId')).toEqual([ID, 'b'])
  })
})

describe('safeAdminPath with the moderation filters', () => {
  it('keeps the Items filter query, including a plus-encoded search', () => {
    const path = '/admin/items?visibility=suspected&q=adobe+pro&page=2'
    expect(safeAdminPath(path)).toBe(path)
  })
})
