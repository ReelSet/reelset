import { describe, expect, it } from 'vitest'
import { dummyDb } from '@/test/dummy-db'
import {
  deleteConversationQuery,
  historyListQuery,
  ownedQueryQuery,
  turnsQuery,
} from './ask-history'

const OWNER = '11111111-1111-4111-8111-111111111111'
const ASK = '22222222-2222-4222-8222-222222222222'
const CONV = '33333333-3333-4333-8333-333333333333'

describe('history access control', () => {
  it('lists only the viewer rows that are answered and not deleted', () => {
    const q = historyListQuery({ profileId: OWNER, cursor: null, limit: 20 }).compile(dummyDb)
    expect(q.sql).toMatch(/profile_id = \$1::uuid/)
    expect(q.sql).toMatch(/deleted_at is null/)
    expect(q.sql).toMatch(/answer is not null/)
    expect(q.parameters[0]).toBe(OWNER)
    expect(q.parameters).toContain(21)
  })

  it('applies the keyset cursor inside the same owner scope', () => {
    const q = historyListQuery({
      profileId: OWNER,
      cursor: { at: '2026-11-09T00:00:00.000Z', key: CONV },
      limit: 10,
    }).compile(dummyDb)
    expect(q.sql).toMatch(/having \(max\(created_at\)/)
    expect(q.parameters).toEqual(expect.arrayContaining([OWNER, CONV]))
  })

  it('looks up an entry only by id AND owner, hiding deleted rows', () => {
    const q = ownedQueryQuery(dummyDb, OWNER, ASK).compile()
    expect(q.sql).toMatch(/"id" = \$1/)
    expect(q.sql).toMatch(/"profile_id" = \$2/)
    expect(q.sql).toMatch(/"deleted_at" is null/)
    expect(q.parameters).toEqual([ASK, OWNER])
  })

  it('loads conversation turns scoped to the owner', () => {
    const q = turnsQuery(dummyDb, OWNER, { id: ASK, conversation_id: CONV }).compile()
    expect(q.sql).toMatch(/"profile_id" = \$1/)
    expect(q.sql).toMatch(/"conversation_id" = \$/)
    expect(q.parameters[0]).toBe(OWNER)
    const single = turnsQuery(dummyDb, OWNER, { id: ASK, conversation_id: null }).compile()
    expect(single.sql).not.toMatch(/conversation_id/)
  })

  it('soft deletes only the owner rows and keeps them for rate limiting', () => {
    const q = deleteConversationQuery(dummyDb, OWNER, ASK).compile()
    expect(q.sql).toMatch(/^update "ask_query" set "deleted_at" = \$1/)
    expect(q.sql).not.toMatch(/^delete/)
    expect(q.sql.match(/"profile_id" = \$/g)?.length).toBeGreaterThanOrEqual(2)
    expect(q.parameters).toEqual(expect.arrayContaining([OWNER, ASK]))
  })
})
