import { describe, expect, it } from 'vitest'
import pino from 'pino'
import { fakeDb } from './fake-db'
import { STALE_REQUEST_MESSAGE, settleReelRequests } from './reel-requests.repo'

const log = pino({ level: 'silent' })
const now = new Date('2026-11-15T12:00:00Z')

describe('settleReelRequests sweeps', () => {
  it('fails and refunds open requests older than 6 hours', async () => {
    const updates: unknown[][] = []
    const { db, log: stmts } = fakeDb((sql, params) => {
      if (sql.startsWith('select "id" from "reel_request"') && sql.includes('"created_at" <')) {
        return [{ id: 'old-1' }]
      }
      if (sql.startsWith('update "reel_request" set "status"')) {
        updates.push([...params])
        return [{ id: 'old-1' }]
      }
      if (sql.startsWith('update "reel_request" set "refunded"')) {
        return [{ user_id: 'u1', credits_charged: 100 }]
      }
      return []
    })
    const res = await settleReelRequests(db, log, now)
    expect(res).toMatchObject({ failed: 1, refunded: 1 })
    expect(updates[0]).toContain(STALE_REQUEST_MESSAGE)
    const cutoff = stmts.find((s) => s.includes('"created_at" <'))
    expect(cutoff).toContain('"status" in')
    expect(stmts.some((s) => s.startsWith('insert into "credit_ledger"'))).toBe(true)
  })

  it('refunds failed requests that were never refunded, idempotently', async () => {
    let refunded = false
    const { db, log: stmts } = fakeDb((sql) => {
      if (sql.includes('"status" = $1') && sql.includes('"refunded" = $2')) return [{ id: 'f-1' }]
      if (sql.startsWith('update "reel_request" set "refunded"')) {
        if (refunded) return []
        refunded = true
        return [{ user_id: 'u1', credits_charged: 100 }]
      }
      return []
    })
    expect((await settleReelRequests(db, log, now)).refunded).toBe(1)
    expect((await settleReelRequests(db, log, now)).refunded).toBe(0)
    expect(stmts.filter((s) => s.startsWith('insert into "credit_ledger"'))).toHaveLength(1)
  })
})
