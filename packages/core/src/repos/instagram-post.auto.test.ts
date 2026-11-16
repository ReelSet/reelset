import { describe, expect, it } from 'vitest'
import { fakeDb } from './fake-db'
import { listAutoPostCandidates } from './instagram-post.repo'

describe('listAutoPostCandidates', () => {
  it('leaves the gate out by default', async () => {
    const { db, log } = fakeDb(() => [])
    await listAutoPostCandidates(db, 5)
    expect(log).toHaveLength(1)
    expect(log[0]).not.toMatch(/gate_decision/)
  })

  it('requires a passing automatic gate decision when asked', async () => {
    const { db, log } = fakeDb(() => [])
    await listAutoPostCandidates(db, 5, { requireGatePass: true })
    const q = log[0]!
    expect(q).toMatch(/from gate_decision d/)
    expect(q).toMatch(/d\.trigger = 'auto'/)
    expect(q).toMatch(/order by d\.created_at desc, d\.id desc limit 1/)
    expect(q).toMatch(/when latest\.label = 'agree' then latest\.verdict = 'reel'/)
    expect(q).toMatch(/when latest\.label = 'disagree' then latest\.verdict <> 'reel'/)
    expect(q).toMatch(/when latest\.decided_by = 'explore' then false/)
  })

  it('runs no query for a zero limit', async () => {
    const { db, log } = fakeDb(() => [])
    expect(await listAutoPostCandidates(db, 0, { requireGatePass: true })).toEqual([])
    expect(log).toEqual([])
  })
})
