import { createLogger, type Database } from '@reelset/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ applied: true }))

vi.mock('@reelset/core', async (orig) => {
  const actual = await orig<typeof import('@reelset/core')>()
  return { ...actual, reviewPublish: vi.fn(async () => m.applied) }
})

const core = await import('@reelset/core')
const { approveSubmission, rejectSubmission } = await import('./publish-review')

const log = createLogger({ app: 'test', level: 'silent' })
const db = {} as Database
const itemId = '99999999-2222-3333-4444-555555555555'

beforeEach(() => {
  vi.clearAllMocks()
  m.applied = true
})

describe('approveSubmission', () => {
  it('approves through the repo, without a note', async () => {
    expect(await approveSubmission(db, { itemId }, log)).toMatchObject({ ok: true })
    expect(core.reviewPublish).toHaveBeenCalledWith(
      db,
      { itemId, decision: 'approve', note: null },
      log,
    )
  })

  it('reports a submission that is no longer pending', async () => {
    m.applied = false
    expect(await approveSubmission(db, { itemId }, log)).toEqual({
      ok: false,
      message: 'Submission is no longer pending',
    })
  })
})

describe('rejectSubmission', () => {
  it('trims the note and stores null for a blank one', async () => {
    await rejectSubmission(db, { itemId, note: '  Too thin  ' }, log)
    expect(core.reviewPublish).toHaveBeenLastCalledWith(
      db,
      { itemId, decision: 'reject', note: 'Too thin' },
      log,
    )
    await rejectSubmission(db, { itemId, note: '   ' }, log)
    expect(core.reviewPublish).toHaveBeenLastCalledWith(
      db,
      { itemId, decision: 'reject', note: null },
      log,
    )
    await rejectSubmission(db, { itemId, note: null }, log)
    expect(core.reviewPublish).toHaveBeenLastCalledWith(
      db,
      { itemId, decision: 'reject', note: null },
      log,
    )
  })

  it('refuses an over-long note without touching the db', async () => {
    const res = await rejectSubmission(db, { itemId, note: 'x'.repeat(301) }, log)
    expect(res.ok).toBe(false)
    expect(core.reviewPublish).not.toHaveBeenCalled()
  })
})
