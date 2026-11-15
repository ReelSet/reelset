import { describe, expect, it } from 'vitest'
import { createLogger } from '../lib/logger'
import { fakeDb } from './fake-db'
import { hideItems, unhideItems } from './visibility.repo'

const log = createLogger({ app: 'test', level: 'silent' })
const IDS = ['0b5d2f3e-6a1c-4e0b-9a55-1c2d3e4f5a6b', '7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f']

describe('hideItems', () => {
  it('does nothing for an empty selection', async () => {
    const { db, log: statements } = fakeDb(() => [])
    expect(await hideItems(db, { itemIds: [], reason: 'spam' }, log)).toEqual({
      changed: 0,
      cancelledPosts: 0,
    })
    expect(statements).toHaveLength(0)
  })

  it('hides only public items and fails their queued posts in one transaction', async () => {
    const { db, log: statements } = fakeDb((sql) =>
      sql.includes('"item"')
        ? [{ id: IDS[0] }]
        : sql.includes('"instagram_post"')
          ? [{ id: 'p1' }]
          : [],
    )
    const result = await hideItems(db, { itemIds: IDS, reason: 'spam' }, log)
    expect(result).toEqual({ changed: 1, cancelledPosts: 1 })
    expect(statements[0]).toBe('begin')
    expect(statements[1]).toMatch(/update "item" set "visibility" = \$1, "hidden_reason" = \$2/)
    expect(statements[1]).toMatch(/"visibility" = \$\d+/)
    expect(statements[2]).toMatch(/update "instagram_post" set "status" = \$1, "error" = \$2/)
    expect(statements.at(-1)).toBe('commit')
  })

  it('skips the Instagram update when nothing was hidden', async () => {
    const { db, log: statements } = fakeDb(() => [])
    expect(await hideItems(db, { itemIds: IDS, reason: 'other' }, log)).toEqual({
      changed: 0,
      cancelledPosts: 0,
    })
    expect(statements.some((s) => s.includes('instagram_post'))).toBe(false)
  })
})

describe('unhideItems', () => {
  it('restores public or private by owner and clears the reason', async () => {
    const { db, log: statements } = fakeDb(() => [{ id: IDS[0] }])
    expect(await unhideItems(db, { itemIds: IDS }, log)).toBe(1)
    expect(statements[0]).toMatch(/case when owner_id is null then 'public' else 'private' end/)
    expect(statements[0]).toMatch(/"hidden_reason" = \$/)
  })

  it('does nothing for an empty selection', async () => {
    const { db } = fakeDb(() => [])
    expect(await unhideItems(db, { itemIds: [] }, log)).toBe(0)
  })
})
