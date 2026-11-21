import { createDb, type Database, type DbHandle } from '@reelset/core'
import { cfContext, type CfRequestContext } from './cf'
import { log } from './logger'

export type DbSource =
  | { kind: 'hyperdrive'; connectionString: string; key: object }
  | { kind: 'env'; connectionString: string }

/** Hyperdrive per Workers request first; DATABASE_URL under Node (dev, Vitest, build prerenders). */
export function resolveDbSource(
  cf: CfRequestContext | undefined,
  env: Record<string, string | undefined>,
): DbSource {
  const hyperdrive = cf?.env.HYPERDRIVE?.connectionString
  if (cf && hyperdrive) return { kind: 'hyperdrive', connectionString: hyperdrive, key: cf.ctx }
  const url = env.DATABASE_URL
  if (!url) throw new Error('missing env var DATABASE_URL')
  return { kind: 'env', connectionString: url }
}

// Workers cannot reuse sockets across requests, so each request gets its own client; workerd
// closes the sockets once the request and its waitUntil work end, and Hyperdrive pools upstream.
const perRequest = new WeakMap<object, DbHandle>()
const globalForDb = globalThis as unknown as { __reelsetDb?: DbHandle }

export function dbFor(source: DbSource, create: typeof createDb = createDb): Database {
  if (source.kind === 'hyperdrive') {
    let handle = perRequest.get(source.key)
    if (!handle) {
      handle = create({ connectionString: source.connectionString, log, max: 5 })
      perRequest.set(source.key, handle)
    }
    return handle.db
  }
  if (!globalForDb.__reelsetDb) {
    globalForDb.__reelsetDb = create({ connectionString: source.connectionString, log, max: 3 })
  }
  return globalForDb.__reelsetDb.db
}

export function getDb(): Database {
  return dbFor(resolveDbSource(cfContext(), process.env))
}
