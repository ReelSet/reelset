import { describe, expect, it } from 'vitest'
import { createLogger } from '../lib/logger'
import { fakeDb } from './fake-db'
import { claimSignupNotification } from './signup.repo'

const log = createLogger({ app: 'test', level: 'silent' })
const createdAt = new Date('2026-11-17T10:00:00Z')

describe('claimSignupNotification', () => {
  it('claims with a single guarded UPDATE ... RETURNING', async () => {
    const { db, log: stmts } = fakeDb(() => [{ created_at: createdAt }])
    expect(await claimSignupNotification(db, 'u1', log)).toEqual({ createdAt })
    expect(stmts).toHaveLength(1)
    expect(stmts[0]).toMatch(/update "profile" set "signup_notified_at" = now\(\)/)
    expect(stmts[0]).toContain('"signup_notified_at" is null')
    expect(stmts[0]).toContain('"created_at" >')
    expect(stmts[0]).toContain('returning "created_at"')
  })

  it('lets exactly one of two concurrent claimers win', async () => {
    let claimed = false
    const { db } = fakeDb(() => {
      if (claimed) return []
      claimed = true
      return [{ created_at: createdAt }]
    })
    const results = await Promise.all([
      claimSignupNotification(db, 'u1', log),
      claimSignupNotification(db, 'u1', log),
    ])
    expect(results.filter(Boolean)).toHaveLength(1)
  })
})
