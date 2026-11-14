import { sql } from 'kysely'
import type { Database } from '../db/client'
import { sha256Hex } from '../domain/hash'
import type { Logger } from '../lib/logger'

export const API_KEY_PREFIX = 'rs_live_'
export const API_KEY_DISPLAY_PREFIX_CHARS = 12
const TOUCH_INTERVAL_MS = 60_000

export type ApiKeyInfo = {
  id: string
  name: string
  prefix: string
  lastUsedAt: Date | null
  revokedAt: Date | null
  createdAt: Date
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function generateApiKeyToken(): string {
  return `${API_KEY_PREFIX}${toBase64Url(crypto.getRandomValues(new Uint8Array(32)))}`
}

export function hashApiKeyToken(token: string): Promise<string> {
  return sha256Hex(token)
}

type KeyRow = {
  id: string
  name: string
  prefix: string
  last_used_at: Date | null
  revoked_at: Date | null
  created_at: Date
}

function toInfo(row: KeyRow): ApiKeyInfo {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
  }
}

/** The plaintext token is returned once; only its sha256 is stored. */
export async function createApiKey(
  db: Database,
  input: { userId: string; name: string },
  log: Logger,
): Promise<{ key: ApiKeyInfo; token: string }> {
  const token = generateApiKeyToken()
  const row = await db
    .insertInto('api_key')
    .values({
      user_id: input.userId,
      name: input.name,
      prefix: token.slice(0, API_KEY_DISPLAY_PREFIX_CHARS),
      hash: await hashApiKeyToken(token),
    })
    .returning(['id', 'name', 'prefix', 'last_used_at', 'revoked_at', 'created_at'])
    .executeTakeFirstOrThrow()
  log.info({ userId: input.userId, keyId: row.id }, 'api key created')
  return { key: toInfo(row), token }
}

export async function findApiKeyByToken(
  db: Database,
  token: string,
  now: Date = new Date(),
): Promise<{ id: string; userId: string; name: string } | null> {
  if (!token.startsWith(API_KEY_PREFIX)) return null
  const row = await db
    .selectFrom('api_key')
    .select(['id', 'user_id', 'name', 'last_used_at'])
    .where('hash', '=', await hashApiKeyToken(token))
    .where('revoked_at', 'is', null)
    .executeTakeFirst()
  if (!row) return null
  if (!row.last_used_at || now.getTime() - row.last_used_at.getTime() >= TOUCH_INTERVAL_MS) {
    await db
      .updateTable('api_key')
      .set({ last_used_at: now })
      .where('id', '=', row.id)
      .where((eb) =>
        eb.or([
          eb('last_used_at', 'is', null),
          eb('last_used_at', '<', new Date(now.getTime() - TOUCH_INTERVAL_MS)),
        ]),
      )
      .execute()
  }
  return { id: row.id, userId: row.user_id, name: row.name }
}

export async function revokeApiKey(
  db: Database,
  input: { id: string; userId: string },
  log: Logger,
): Promise<boolean> {
  const res = await db
    .updateTable('api_key')
    .set({ revoked_at: sql`now()` })
    .where('id', '=', input.id)
    .where('user_id', '=', input.userId)
    .where('revoked_at', 'is', null)
    .executeTakeFirst()
  const revoked = Number(res.numUpdatedRows) > 0
  log.info({ userId: input.userId, keyId: input.id, revoked }, 'api key revoke')
  return revoked
}

export async function listApiKeys(db: Database, userId: string): Promise<ApiKeyInfo[]> {
  const rows = await db
    .selectFrom('api_key')
    .select(['id', 'name', 'prefix', 'last_used_at', 'revoked_at', 'created_at'])
    .where('user_id', '=', userId)
    .orderBy('created_at', 'desc')
    .execute()
  return rows.map(toInfo)
}
