import type { Database } from '@reelset/core'
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

export type Scripted = Record<string, unknown>[] | { affected: number } | Error

/** Test double: a real Kysely over a driver that answers each compiled query from `respond` and records it. */
export function scriptedDb(respond: (query: CompiledQuery) => Scripted) {
  const queries: CompiledQuery[] = []
  const connection: DatabaseConnection = {
    async executeQuery<R>(query: CompiledQuery): Promise<QueryResult<R>> {
      queries.push(query)
      const out = respond(query)
      if (out instanceof Error) throw out
      if (Array.isArray(out)) return { rows: out as R[] }
      return { rows: [], numAffectedRows: BigInt(out.affected) }
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

export const sqlHas = (query: CompiledQuery, text: string): boolean => query.sql.includes(text)
