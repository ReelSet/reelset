import { createLogger, type Database } from '@reelset/core'
import {
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type CompiledQuery,
  type DatabaseConnection,
  type Driver,
  type QueryResult,
} from 'kysely'
import { describe, expect, it } from 'vitest'
import { grantUserCredits, listUsers, userStats } from './users'

type Handler = (sql: string, params: readonly unknown[]) => Record<string, unknown>[]

function fakeDb(handler: Handler): { db: Database; log: string[] } {
  const log: string[] = []
  const connection: DatabaseConnection = {
    async executeQuery<R>(q: CompiledQuery): Promise<QueryResult<R>> {
      log.push(q.sql)
      return { rows: handler(q.sql, q.parameters) as R[] }
    },
    streamQuery: () => {
      throw new Error('not used')
    },
  }
  const driver: Driver = {
    init: async () => {},
    acquireConnection: async () => connection,
    beginTransaction: async () => {},
    commitTransaction: async () => {},
    rollbackTransaction: async () => {},
    releaseConnection: async () => {},
    destroy: async () => {},
  }
  const db = new Kysely({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => driver,
      createIntrospector: (k) => new PostgresIntrospector(k),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  }) as unknown as Database
  return { db, log }
}

const log = createLogger({ app: 'test', level: 'silent' })
const NOW = new Date('2026-11-15T12:00:00Z')
const PAGE = { page: 2, pageSize: 2, offset: 2 }
const row = (n: number) => ({ id: `u${n}`, reel_count: n, month_delta: '-2' })

describe('listUsers', () => {
  it('keeps search text out of the SQL text', async () => {
    const hostile = "x'; drop table profile; --"
    const { db, log: sqlLog } = fakeDb(() => [])
    await listUsers(db, PAGE, { search: hostile }, { key: 'joined', dir: 'desc' }, NOW)
    expect(sqlLog[0]).not.toContain('drop table')
    expect(sqlLog[0]).toContain('ilike')
  })

  it('passes escaped wildcards, the month key and paging as parameters', async () => {
    let params: readonly unknown[] = []
    const { db } = fakeDb((_sql, p) => {
      params = p
      return []
    })
    await listUsers(db, PAGE, { search: 'a_b' }, { key: 'joined', dir: 'desc' }, NOW)
    expect(params).toContain('2026-11')
    expect(params.filter((p) => p === '%a\\_b%')).toHaveLength(4)
    expect(params).toContain(3)
    expect(params).toContain(2)
  })

  it('maps each sort key to a fixed expression and direction', async () => {
    const cases = [
      ['joined', 'p.created_at'],
      ['active', 'last_active_at'],
      ['reels', 'reel_count'],
    ] as const
    for (const [key, expr] of cases) {
      const { db, log: sqlLog } = fakeDb(() => [])
      await listUsers(db, PAGE, { search: null }, { key, dir: 'asc' }, NOW)
      expect(sqlLog[0]).toContain(`order by ${expr} asc nulls last, p.id`)
    }
  })

  it('fetches one extra row to detect another page and derives credits used', async () => {
    const { db } = fakeDb(() => [row(1), row(2), row(3)])
    const out = await listUsers(db, PAGE, { search: null }, { key: 'reels', dir: 'desc' }, NOW)
    expect(out.rows).toHaveLength(2)
    expect(out.hasMore).toBe(true)
    expect(out.rows[0]?.credits_used).toBe(2)
  })

  it('returns an empty page without error', async () => {
    const { db } = fakeDb(() => [])
    const out = await listUsers(db, PAGE, { search: null }, { key: 'joined', dir: 'desc' }, NOW)
    expect(out).toEqual({ rows: [], hasMore: false })
  })
})

describe('userStats', () => {
  it('parses the counts and uses a 7 day window', async () => {
    let params: readonly unknown[] = []
    const { db } = fakeDb((_s, p) => {
      params = p
      return [{ total: '12', new_in_window: '3', active_in_window: '5' }]
    })
    expect(await userStats(db, NOW)).toEqual({ total: 12, newInWindow: 3, activeInWindow: 5 })
    expect((params[0] as Date).toISOString()).toBe('2026-11-08T12:00:00.000Z')
  })
})

describe('grantUserCredits', () => {
  it('rejects invalid amounts before touching the database', async () => {
    const { db, log: sqlLog } = fakeDb(() => [])
    for (const credits of [0, -5, 1.5, 'abc', 1_000_000]) {
      const res = await grantUserCredits(db, { userId: 'u1', credits }, log)
      expect(res.ok).toBe(false)
    }
    expect(sqlLog).toHaveLength(0)
  })

  it('refuses unknown users and grants to known ones', async () => {
    const missing = fakeDb(() => [])
    expect((await grantUserCredits(missing.db, { userId: 'u1', credits: 5 }, log)).ok).toBe(false)
    const known = fakeDb((sql) => (sql.includes('from "profile"') ? [{ id: 'u1' }] : []))
    const res = await grantUserCredits(known.db, { userId: 'u1', credits: '5' }, log)
    expect(res).toEqual({ ok: true, message: 'Granted 5 credits' })
    expect(known.log.some((s) => s.includes('insert into "credit_ledger"'))).toBe(true)
  })
})
