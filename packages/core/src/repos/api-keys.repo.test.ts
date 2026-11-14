import { describe, expect, it } from 'vitest'
import pino from 'pino'
import { fakeDb } from './fake-db'
import {
  API_KEY_PREFIX,
  createApiKey,
  findApiKeyByToken,
  generateApiKeyToken,
  hashApiKeyToken,
} from './api-keys.repo'

const log = pino({ level: 'silent' })

describe('api keys', () => {
  it('generates rs_live_ tokens with 32 random bytes', () => {
    const token = generateApiKeyToken()
    expect(token.startsWith(API_KEY_PREFIX)).toBe(true)
    expect(token.slice(API_KEY_PREFIX.length)).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(generateApiKeyToken()).not.toBe(token)
  })

  it('stores only the sha256 hash and a 12 char prefix', async () => {
    let params: readonly unknown[] = []
    const { db } = fakeDb((sql, p) => {
      if (!sql.startsWith('insert into "api_key"')) return []
      params = p
      return [
        {
          id: 'k1',
          name: 'cli',
          prefix: 'x',
          last_used_at: null,
          revoked_at: null,
          created_at: new Date(),
        },
      ]
    })
    const { token } = await createApiKey(db, { userId: 'u1', name: 'cli' }, log)
    expect(params).toContain(await hashApiKeyToken(token))
    expect(params).toContain(token.slice(0, 12))
    expect(params).not.toContain(token)
    expect(await hashApiKeyToken(token)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('looks keys up by hash among non-revoked rows', async () => {
    const token = generateApiKeyToken()
    const hash = await hashApiKeyToken(token)
    const { db, log: stmts } = fakeDb((sql, p) => {
      if (sql.startsWith('select') && p.includes(hash)) {
        expect(sql).toContain('"revoked_at" is null')
        return [{ id: 'k1', user_id: 'u1', name: 'cli', last_used_at: null }]
      }
      return []
    })
    expect(await findApiKeyByToken(db, token)).toEqual({ id: 'k1', userId: 'u1', name: 'cli' })
    expect(stmts.some((s) => s.startsWith('update "api_key"'))).toBe(true)
    expect(await findApiKeyByToken(db, generateApiKeyToken())).toBeNull()
    expect(await findApiKeyByToken(db, 'sk_other_token')).toBeNull()
  })

  it('touches last_used_at at most once per minute', async () => {
    const now = new Date('2026-11-15T12:00:00Z')
    const row = (lastUsed: Date) => [{ id: 'k1', user_id: 'u1', name: 'n', last_used_at: lastUsed }]
    const recent = fakeDb((sql) =>
      sql.startsWith('select') ? row(new Date(now.getTime() - 10_000)) : [],
    )
    await findApiKeyByToken(recent.db, generateApiKeyToken(), now)
    expect(recent.log.some((s) => s.startsWith('update'))).toBe(false)
    const stale = fakeDb((sql) =>
      sql.startsWith('select') ? row(new Date(now.getTime() - 120_000)) : [],
    )
    await findApiKeyByToken(stale.db, generateApiKeyToken(), now)
    expect(stale.log.some((s) => s.startsWith('update'))).toBe(true)
  })
})
