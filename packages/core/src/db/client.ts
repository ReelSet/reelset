import { Kysely, PostgresDialect, type LogEvent } from 'kysely'
import pg from 'pg'
import { errorFields, type Logger } from '../lib/logger'
import type { DB } from './types'

export type Database = Kysely<DB>

export type DbOptions = {
  connectionString: string
  log: Logger
  max?: number
}

export type DbHandle = {
  db: Database
  close: () => Promise<void>
}

export function createDb({ connectionString, log, max = 10 }: DbOptions): DbHandle {
  const l = log.child({ mod: 'db' })

  const pool = new pg.Pool({
    connectionString,
    max,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    keepAlive: true,
  })

  // Workers tear sockets down when the invocation ends, so idle clients error after destroy().
  let closing = false

  pool.on('error', (err) => {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ETIMEDOUT' || code === 'ECONNRESET' || code === 'EPIPE') {
      l.warn({ ...errorFields(err), code }, 'pg idle client dropped, pool will reconnect')
      return
    }
    if (closing && /socket has been closed/i.test(err.message)) {
      l.debug('pg socket closed during pool shutdown')
      return
    }
    l.error(errorFields(err), 'pg pool error')
  })

  const logQuery = (event: LogEvent): void => {
    const durationMs = Math.round(event.queryDurationMillis)
    if (event.level === 'error') {
      l.error({ sql: event.query.sql, durationMs, ...errorFields(event.error) }, 'query failed')
      return
    }
    l.debug({ sql: event.query.sql, durationMs }, 'query ok')
  }

  const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }), log: logQuery })
  l.debug({ max }, 'db pool created')

  return {
    db,
    close: async () => {
      closing = true
      await db.destroy()
      l.debug('db pool closed')
    },
  }
}
