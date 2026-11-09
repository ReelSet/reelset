import { createDb, type Database, type DbHandle } from '@reelset/core'
import { requireEnv } from './env'
import { log } from './logger'

const globalForDb = globalThis as unknown as { __reelsetDb?: DbHandle }

export function getDb(): Database {
  if (!globalForDb.__reelsetDb) {
    globalForDb.__reelsetDb = createDb({
      connectionString: requireEnv('DATABASE_URL'),
      log,
      max: 3,
    })
  }
  return globalForDb.__reelsetDb.db
}
