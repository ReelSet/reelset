import { createDb, type Database, type Logger } from '@reelset/core'
import { DEFAULT_MEDIA_BASE_URL } from '../constants'
import type { ContainerFetcher } from '../container-client'
import type { Env } from '../env'
import { createIgContainerClient } from './container-client'
import { importSessionKey } from './crypto'
import type { IgDeps } from './service'
import { createIgStore } from './store'

export const IG_CONTAINER_SLOT = 'instagram'

export function igConfigured(env: Env): boolean {
  return Boolean(env.IG_USERNAME && env.IG_PASSWORD && env.IG_SESSION_KEY)
}

export async function buildIgDeps(
  env: Env,
  db: Database,
  container: ContainerFetcher,
  log: Logger,
): Promise<IgDeps> {
  if (!env.IG_USERNAME || !env.IG_PASSWORD || !env.IG_SESSION_KEY) {
    throw new Error('instagram secrets are not configured')
  }
  return {
    store: createIgStore(db, log),
    client: createIgContainerClient(container, log),
    key: await importSessionKey(env.IG_SESSION_KEY),
    creds: { username: env.IG_USERNAME, password: env.IG_PASSWORD, totpSecret: env.IG_TOTP_SECRET },
    mediaBaseUrl: (env.MEDIA_PUBLIC_BASE_URL ?? DEFAULT_MEDIA_BASE_URL).replace(/\/$/, ''),
    log,
  }
}

export async function withIgDeps<T>(
  env: Env,
  container: ContainerFetcher,
  log: Logger,
  fn: (deps: IgDeps) => Promise<T>,
): Promise<T> {
  const { db, close } = createDb({ connectionString: env.HYPERDRIVE.connectionString, log, max: 1 })
  try {
    return await fn(await buildIgDeps(env, db, container, log))
  } finally {
    await close()
  }
}
