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
import { overviewStats } from './stats'

const log = createLogger({ app: 'test', level: 'silent' })
const NOW = new Date('2026-11-15T12:00:00Z')

function scriptedDb(respond: (q: CompiledQuery) => Record<string, unknown>[] | Error) {
  const queries: CompiledQuery[] = []
  const connection: DatabaseConnection = {
    async executeQuery<R>(query: CompiledQuery): Promise<QueryResult<R>> {
      queries.push(query)
      const out = respond(query)
      if (out instanceof Error) throw out
      return { rows: out as R[] }
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
  return { db, queries }
}

const has = (q: CompiledQuery, text: string) => q.sql.includes(text)

function respondEmpty(q: CompiledQuery): Record<string, unknown>[] {
  if (has(q, 'distinct profile_id) filter')) return [{ cur: '3', prev: '1' }]
  if (has(q, 'from "profile"') && has(q, 'count(*) as "n"')) return [{ n: '42' }]
  if (has(q, 'from "profile"')) return [{ day: '2026-11-15', value: '2' }]
  if (has(q, '"publish_review"')) return [{ n: '7' }]
  if (has(q, 'from "gate_decision"')) return [{ n: '8' }]
  if (has(q, 'from "item"')) return [{ n: '3' }]
  if (has(q, '"instagram_post"')) return [{ n: '4' }]
  if (has(q, '"credit_upgrade_request"')) return [{ n: '5' }]
  if (has(q, '"reel_request"') && has(q, 'count(*) as "n"')) return [{ n: '6' }]
  return []
}

describe('overviewStats', () => {
  it('zero-fills, binds the time zone as a parameter and computes attention', async () => {
    const { db, queries } = scriptedDb(respondEmpty)
    const out = await overviewStats(db, log, { days: 7, tz: 'Asia/Kolkata', now: NOW })

    const profileQuery = queries.find((q) => has(q, 'from "profile"') && has(q, 'group by'))!
    expect(profileQuery.parameters).toContain('Asia/Kolkata')
    expect(profileQuery.sql).not.toContain('Asia/Kolkata')

    const users = out.metrics.newUsers
    expect(users.points).toHaveLength(7)
    expect(users.points.at(-1)).toMatchObject({ day: '2026-11-15', value: 2 })
    expect(users.total).toBe(2)
    expect(out.metrics.views.total).toBe(0)
    expect(out.metrics.views.deltaPct).toBeNull()

    expect(out.metrics.activeUsers.total).toBe(3)
    expect(out.metrics.activeUsers.deltaPct).toBe(200)
    expect(out.totalUsers).toBe(42)
    expect(out.attention).toEqual({
      failedItems: 3,
      failedInstagramPosts: 4,
      openUpgradeRequests: 5,
      openReelRequests: 6,
      pendingFeedSubmissions: 7,
      gateAwaitingReview: 8,
    })
    expect(out.unavailable).toEqual([])
  })

  it('runs one grouped query per metric', async () => {
    const { db, queries } = scriptedDb(respondEmpty)
    await overviewStats(db, log, { days: 30, tz: 'UTC', now: NOW })
    const grouped = queries.filter((q) => has(q, 'group by 1'))
    expect(grouped).toHaveLength(8)
  })

  it('keeps every other attention count when the gate table does not exist yet', async () => {
    const { db } = scriptedDb((q) =>
      has(q, 'gate_decision') ? new Error('relation does not exist') : respondEmpty(q),
    )
    const out = await overviewStats(db, log, { days: 7, tz: 'UTC', now: NOW })
    expect(out.attention).toMatchObject({ failedItems: 3, gateAwaitingReview: 0 })
  })

  it('degrades a failing metric to zeros instead of failing the page', async () => {
    const { db } = scriptedDb((q) => (has(q, 'ask_query') ? new Error('boom') : respondEmpty(q)))
    const out = await overviewStats(db, log, { days: 7, tz: 'UTC', now: NOW })
    expect(out.unavailable).toEqual(['asks'])
    expect(out.metrics.asks.total).toBe(0)
    expect(out.metrics.newUsers.total).toBe(2)
  })
})
