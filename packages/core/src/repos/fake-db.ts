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
import type { Database } from '../db/client'

export type Handler = (sql: string, params: readonly unknown[]) => Record<string, unknown>[]

/** Kysely over a scripted driver: every statement is recorded and answered by `handler`. */
export function fakeDb(handler: Handler): { db: Database; log: string[] } {
  const log: string[] = []
  const connection: DatabaseConnection = {
    async executeQuery<R>(q: CompiledQuery): Promise<QueryResult<R>> {
      log.push(q.sql)
      const rows = handler(q.sql, q.parameters)
      return { rows: rows as R[], numAffectedRows: BigInt(rows.length) }
    },
    // eslint-disable-next-line require-yield
    async *streamQuery() {
      throw new Error('streaming not supported')
    },
  }
  const driver: Driver = {
    init: async () => {},
    acquireConnection: async () => connection,
    beginTransaction: async () => {
      log.push('begin')
    },
    commitTransaction: async () => {
      log.push('commit')
    },
    rollbackTransaction: async () => {
      log.push('rollback')
    },
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
