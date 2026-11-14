import { describe, expect, it } from 'vitest'
import pino from 'pino'
import { fakeDb } from './fake-db'
import {
  balanceFrom,
  creditBalance,
  creditMonth,
  createChargedReelRequest,
  creditResetsAt,
  refundRequest,
  spendCredits,
} from './credits.repo'

const log = pino({ level: 'silent' })

describe('credit months', () => {
  it('keys by UTC month and resets at the next month start', () => {
    expect(creditMonth(new Date('2026-11-30T23:59:59Z'))).toBe('2026-11')
    expect(creditMonth(new Date('2026-12-01T00:00:00Z'))).toBe('2026-12')
    expect(creditResetsAt(new Date('2026-12-15T10:00:00Z')).toISOString()).toBe(
      '2027-01-01T00:00:00.000Z',
    )
  })
  it('adds the month deltas to the free allowance', () => {
    expect(balanceFrom(1000, -300)).toBe(700)
    expect(balanceFrom(1000, 500)).toBe(1500)
  })
})

describe('creditBalance', () => {
  it('only sums the requested month, so unused credits do not roll over', async () => {
    const ledger = [
      { month: '2026-10', delta: -900 },
      { month: '2026-11', delta: -100 },
      { month: '2026-11', delta: 250 },
    ]
    const { db } = fakeDb((_sql, params) => {
      const month = params.find((p) => typeof p === 'string' && /^\d{4}-\d{2}$/.test(p))
      const total = ledger.filter((l) => l.month === month).reduce((a, l) => a + l.delta, 0)
      return [{ total: String(total) }]
    })
    expect(await creditBalance(db, 'u1', 1000, new Date('2026-10-20T00:00:00Z'))).toBe(100)
    expect(await creditBalance(db, 'u1', 1000, new Date('2026-11-02T00:00:00Z'))).toBe(1150)
    expect(await creditBalance(db, 'u1', 1000, new Date('2026-12-02T00:00:00Z'))).toBe(1000)
  })
})

describe('spendCredits', () => {
  const run = (sum: number, cost: number) => {
    const { db, log: stmts } = fakeDb((sql) =>
      sql.includes('sum(delta)') ? [{ total: String(sum) }] : [],
    )
    return spendCredits(
      db,
      { userId: 'u1', cost, monthlyFree: 1000, now: new Date('2026-11-05T00:00:00Z') },
      log,
    ).then((result) => ({ result, stmts }))
  }

  it('locks the user, then debits when the balance covers the cost', async () => {
    const { result, stmts } = await run(-800, 100)
    expect(result).toEqual({ ok: true, balance: 100 })
    expect(stmts[0]).toBe('begin')
    expect(stmts[1]).toContain('pg_advisory_xact_lock')
    expect(stmts.some((s) => s.startsWith('insert into "credit_ledger"'))).toBe(true)
    expect(stmts.at(-1)).toBe('commit')
  })

  it('refuses without writing when the balance is below the cost', async () => {
    const { result, stmts } = await run(-950, 100)
    expect(result).toEqual({ ok: false, balance: 50 })
    expect(stmts.some((s) => s.startsWith('insert into'))).toBe(false)
  })

  it('allows spending the exact remaining balance', async () => {
    expect((await run(-900, 100)).result).toEqual({ ok: true, balance: 0 })
  })
})

describe('refundRequest', () => {
  it('refunds once: the guarded update finds nothing the second time', async () => {
    let refunded = false
    const { db, log: stmts } = fakeDb((sql) => {
      if (sql.startsWith('update "reel_request"')) {
        if (refunded) return []
        refunded = true
        return [{ user_id: 'u1', credits_charged: 100 }]
      }
      if (sql.startsWith('select "month"')) return [{ month: '2026-10' }]
      return []
    })
    expect(await refundRequest(db, 'r1', log)).toBe(true)
    expect(await refundRequest(db, 'r1', log)).toBe(false)
    expect(stmts.filter((s) => s.startsWith('insert into "credit_ledger"'))).toHaveLength(1)
  })

  it('refunds into the current month, not the month of the spend', async () => {
    const params: unknown[][] = []
    const { db } = fakeDb((sql, p) => {
      if (sql.startsWith('insert into "credit_ledger"')) params.push([...p])
      return sql.startsWith('update "reel_request"')
        ? [{ user_id: 'u1', credits_charged: 100 }]
        : []
    })
    await refundRequest(db, 'r1', log, new Date('2026-12-02T00:00:00Z'))
    expect(params[0]).toContain('2026-12')
  })
})

describe('createChargedReelRequest', () => {
  const input = {
    userId: 'u1',
    urls: ['https://a.test'],
    via: 'web' as const,
    cost: 100,
    monthlyFree: 1000,
    now: new Date('2026-11-05T00:00:00Z'),
  }
  const run = (sum: number) => {
    const { db, log: stmts } = fakeDb((sql) => {
      if (sql.includes('sum(delta)')) return [{ total: String(sum) }]
      if (sql.startsWith('insert into "reel_request"')) return [{ id: 'r1', credits_charged: 100 }]
      return []
    })
    return createChargedReelRequest(db, input, log).then((result) => ({ result, stmts }))
  }

  it('locks, inserts the request and the ledger debit in one transaction', async () => {
    const { result, stmts } = await run(-800)
    expect(result).toMatchObject({ ok: true, balance: 100, request: { id: 'r1' } })
    expect(stmts[0]).toBe('begin')
    expect(stmts[1]).toContain('pg_advisory_xact_lock')
    const req = stmts.findIndex((s) => s.startsWith('insert into "reel_request"'))
    const ledger = stmts.findIndex((s) => s.startsWith('insert into "credit_ledger"'))
    expect(req).toBeGreaterThan(1)
    expect(ledger).toBeGreaterThan(req)
    expect(stmts.at(-1)).toBe('commit')
  })

  it('inserts nothing when the balance is short', async () => {
    const { result, stmts } = await run(-950)
    expect(result).toEqual({ ok: false, balance: 50 })
    expect(stmts.some((s) => s.startsWith('insert into'))).toBe(false)
  })
})
