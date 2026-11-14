import { describe, expect, it } from 'vitest'
import { transitionClearingPriority } from '../src/generate/priority'
import { createFakeDb, type RecordedQuery } from './helpers/fake-db'
import { testLog } from './helpers/mock-fetch'

function db() {
  return createFakeDb((q: RecordedQuery) => {
    if (q.sql.startsWith('update "item" set "status"')) return { rows: [], affected: 1 }
    return undefined
  })
}

describe('transitionClearingPriority', () => {
  it.each(['failed', 'insufficient_source'] as const)('clears priority_at on %s', async (to) => {
    const fake = db()
    await transitionClearingPriority(
      fake.db,
      { itemId: 'item-1', from: 'found', to, attempt: 1 },
      testLog,
    )
    const clear = fake.find('"priority_at" = $1')
    expect(clear).toHaveLength(1)
    expect(clear[0]!.params).toEqual([null, 'item-1'])
  })

  it('keeps priority_at while the item is still moving through the pipeline', async () => {
    const fake = db()
    await transitionClearingPriority(
      fake.db,
      { itemId: 'item-1', from: 'found', to: 'summarized', attempt: 1 },
      testLog,
    )
    expect(fake.find('"priority_at"')).toHaveLength(0)
  })
})
