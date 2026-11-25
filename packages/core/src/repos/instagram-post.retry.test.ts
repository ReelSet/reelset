import { describe, expect, it } from 'vitest'
import { INSTAGRAM_LOST_ERROR, INSTAGRAM_NOT_FOUND_ERROR } from '../domain/instagram-post'
import { fakeDb, type Handler } from './fake-db'
import { retryInstagramPost } from './instagram-post.repo'

const ID = '7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f'
const ITEM = '0b5d2f3e-6a1c-4e0b-9a55-1c2d3e4f5a6b'
const HOURS = 3_600_000

type Failed = { status: string; error: string | null; startedAt: Date | null }

// The update matches nothing; the diagnosis selects return the scripted row and live sibling.
function refused(row: Failed | null, liveSibling = false): Handler {
  return (sql) => {
    if (sql.startsWith('update')) return []
    if (sql.includes('"item_id", "status"')) {
      return row
        ? [{ item_id: ITEM, status: row.status, error: row.error, started_at: row.startedAt }]
        : []
    }
    return liveSibling ? [{ id: 'other' }] : []
  }
}

describe('retryInstagramPost', () => {
  it('re-queues in one guarded update that clears error and started_at and restarts the queue age', async () => {
    const { db, log } = fakeDb((sql) => (sql.startsWith('update') ? [{ id: ID }] : []))
    expect(await retryInstagramPost(db, ID)).toEqual({ changed: true })
    expect(log).toHaveLength(1)
    expect(log[0]).toMatch(
      /set "status" = \$1, "error" = \$2, "started_at" = \$3, "created_at" = now\(\), "updated_at" = now\(\)/,
    )
    expect(log[0]).toMatch(/"status" = \$\d+/)
    expect(log[0]).toMatch(/not exists/)
    expect(log[0]).toMatch(/not coalesce/)
  })

  it('reports not_found', async () => {
    const { db } = fakeDb(refused(null))
    expect(await retryInstagramPost(db, ID)).toEqual({ changed: false, reason: 'not_found' })
  })

  it('reports not_failed for a row in another status', async () => {
    const { db } = fakeDb(refused({ status: 'posted', error: null, startedAt: null }))
    expect(await retryInstagramPost(db, ID)).toEqual({ changed: false, reason: 'not_failed' })
  })

  it('reports still_checking while the lost-upload lookup window is open', async () => {
    const startedAt = new Date(Date.now() - HOURS)
    const { db } = fakeDb(refused({ status: 'failed', error: INSTAGRAM_LOST_ERROR, startedAt }))
    expect(await retryInstagramPost(db, ID)).toEqual({ changed: false, reason: 'still_checking' })
  })

  it('reports already_live_or_queued when a sibling row is live', async () => {
    const { db } = fakeDb(
      refused({ status: 'failed', error: INSTAGRAM_NOT_FOUND_ERROR, startedAt: null }, true),
    )
    expect(await retryInstagramPost(db, ID)).toEqual({
      changed: false,
      reason: 'already_live_or_queued',
    })
  })

  it('maps a unique-index violation from a racing queue to already_live_or_queued', async () => {
    const { db } = fakeDb((sql) => {
      if (sql.startsWith('update')) throw Object.assign(new Error('dup'), { code: '23505' })
      return []
    })
    expect(await retryInstagramPost(db, ID)).toEqual({
      changed: false,
      reason: 'already_live_or_queued',
    })
  })

  it('rethrows unexpected database errors', async () => {
    const { db } = fakeDb(() => {
      throw new Error('boom')
    })
    await expect(retryInstagramPost(db, ID)).rejects.toThrow('boom')
  })
})
