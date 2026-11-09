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
import type { DB } from '@reelset/core'

export type RecordedQuery = { sql: string; params: readonly unknown[] }
export type HandlerResult = unknown[] | { rows: unknown[]; affected?: number } | undefined
export type Handler = (query: RecordedQuery) => HandlerResult

class FakeConnection implements DatabaseConnection {
  constructor(
    private readonly handler: Handler,
    private readonly queries: RecordedQuery[],
  ) {}

  async executeQuery<R>(compiled: CompiledQuery): Promise<QueryResult<R>> {
    const recorded = { sql: compiled.sql, params: compiled.parameters }
    this.queries.push(recorded)
    const result = this.handler(recorded)
    const rows = Array.isArray(result) ? result : (result?.rows ?? [])
    const affected =
      Array.isArray(result) || !result ? rows.length : (result.affected ?? rows.length)
    return { rows: rows as R[], numAffectedRows: BigInt(affected) }
  }

  // eslint-disable-next-line require-yield
  async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
    throw new Error('streaming is not supported by the fake db')
  }
}

class FakeDriver implements Driver {
  constructor(private readonly connection: FakeConnection) {}
  async init() {}
  async acquireConnection() {
    return this.connection
  }
  async beginTransaction() {}
  async commitTransaction() {}
  async rollbackTransaction() {}
  async releaseConnection() {}
  async destroy() {}
}

export function createFakeDb(handler: Handler = () => undefined) {
  const queries: RecordedQuery[] = []
  const connection = new FakeConnection(handler, queries)
  const db = new Kysely<DB>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new FakeDriver(connection),
      createIntrospector: (k) => new PostgresIntrospector(k),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  })
  return {
    db,
    queries,
    find: (fragment: string) => queries.filter((q) => q.sql.includes(fragment)),
  }
}
