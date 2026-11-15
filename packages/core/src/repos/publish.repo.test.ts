import { describe, expect, it } from 'vitest'
import { createLogger } from '../lib/logger'
import { fakeDb } from './fake-db'
import { requestPublish, reviewPublish, withdrawPublish } from './publish.repo'

const log = createLogger({ app: 'test', level: 'silent' })
const ids = { itemId: 'i1', ownerId: 'u1' }

describe('requestPublish', () => {
  it('only touches a finished private reel owned by the requester', async () => {
    const { db, log: stmts } = fakeDb((sql) =>
      sql.startsWith('update "item"') ? [{ id: 'i1' }] : [],
    )
    expect(await requestPublish(db, ids, log)).toEqual({ ok: true })
    const update = stmts[0]!
    expect(update).toContain('"owner_id" = $')
    expect(update).toContain('"visibility" = $')
    expect(update).toContain('"status" = $')
    expect(update).toContain('"publish_review" is null or "publish_review" in')
    expect(update).toContain("r.status = 'done'")
  })

  it('explains a refusal: missing item, already in review, not finished', async () => {
    const lookup = (row: Record<string, unknown> | null) =>
      fakeDb((sql) => (sql.startsWith('select') && row ? [row] : []))
    expect(await requestPublish(lookup(null).db, ids, log)).toEqual({
      ok: false,
      reason: 'not_found',
    })
    const pending = { status: 'rendered', visibility: 'private', publish_review: 'pending' }
    expect(await requestPublish(lookup(pending).db, ids, log)).toEqual({
      ok: false,
      reason: 'already_submitted',
    })
    const live = { status: 'rendered', visibility: 'public', publish_review: 'approved' }
    expect(await requestPublish(lookup(live).db, ids, log)).toMatchObject({
      reason: 'already_submitted',
    })
    const rendering = { status: 'voiced', visibility: 'private', publish_review: null }
    expect(await requestPublish(lookup(rendering).db, ids, log)).toEqual({
      ok: false,
      reason: 'not_ready',
    })
  })

  it('never lets a hidden reel back in: the update requires private visibility', async () => {
    const { db, log: stmts } = fakeDb(() => [])
    const hidden = { status: 'rendered', visibility: 'hidden', publish_review: null }
    const lookup = fakeDb((sql) => (sql.startsWith('select') ? [hidden] : []))
    expect(await requestPublish(lookup.db, ids, log)).toEqual({ ok: false, reason: 'not_ready' })
    await requestPublish(db, ids, log)
    expect(stmts[0]).toMatch(/"visibility" = \$\d+/)
  })
})

describe('withdrawPublish', () => {
  it('returns a public or in-review reel to private and clears the review', async () => {
    const { db, log: stmts } = fakeDb(() => [{ id: 'i1' }])
    expect(await withdrawPublish(db, ids, log)).toEqual({ ok: true })
    expect(stmts[0]).toMatch(/update "item" set "visibility" = \$1, "publish_review" = \$2/)
  })

  it('refuses when there is nothing to withdraw', async () => {
    const idle = { status: 'rendered', visibility: 'private', publish_review: null }
    const { db } = fakeDb((sql) => (sql.startsWith('select') ? [idle] : []))
    expect(await withdrawPublish(db, ids, log)).toEqual({ ok: false, reason: 'not_submitted' })
    const gone = fakeDb(() => [])
    expect(await withdrawPublish(gone.db, ids, log)).toEqual({ ok: false, reason: 'not_found' })
  })
})

describe('reviewPublish', () => {
  it('approves a pending private submission and publishes it in one statement', async () => {
    const { db, log: stmts } = fakeDb(() => [{ id: 'i1' }])
    expect(await reviewPublish(db, { itemId: 'i1', decision: 'approve', note: null }, log)).toBe(
      true,
    )
    expect(stmts[0]).toContain('"visibility" =')
    expect(stmts[0]).toContain('"publish_review" = $')
    expect(stmts.length).toBe(1)
  })

  it('rejects without touching visibility and keeps the note', async () => {
    const params: unknown[][] = []
    const { db, log: stmts } = fakeDb((_sql, p) => {
      params.push([...p])
      return [{ id: 'i1' }]
    })
    await reviewPublish(db, { itemId: 'i1', decision: 'reject', note: 'Too thin' }, log)
    expect(stmts[0]).not.toMatch(/set "visibility"|, "visibility" =/)
    expect(params[0]).toContain('Too thin')
    expect(params[0]).toContain('rejected')
  })

  it('is a no-op when the submission is no longer pending', async () => {
    const { db } = fakeDb(() => [])
    expect(await reviewPublish(db, { itemId: 'i1', decision: 'approve', note: null }, log)).toBe(
      false,
    )
  })
})
