import pino from 'pino'
import { describe, expect, it } from 'vitest'
import type { Database } from '@reelset/core'
import { recordViews } from './views'
import { VIEWS_PER_VIEWER_PER_HOUR } from '@/lib/views'

const log = pino({ level: 'silent' })
const A = '3f2b8d1e-5c4a-4e6f-9a1b-2c3d4e5f6a7b'
const B = '4f2b8d1e-5c4a-4e6f-9a1b-2c3d4e5f6a7c'

// Minimal chainable stand-in: every builder method returns the chain, terminals resolve per table.
function fakeDb(opts: { recent: number; visible: string[]; fresh: string[] }) {
  const calls = { updated: [] as string[][], inserted: 0 }
  const chain = (table: string, mode: 'select' | 'insert' | 'update') => {
    const c: Record<string, unknown> = {}
    const self = () => c
    for (const m of ['select', 'where', 'values', 'onConflict', 'returning', 'set']) c[m] = self
    c['executeTakeFirstOrThrow'] = async () => ({ n: String(opts.recent) })
    c['execute'] = async () => {
      if (mode === 'insert') {
        calls.inserted += 1
        return opts.fresh.map((item_id) => ({ item_id }))
      }
      if (mode === 'update') {
        calls.updated.push(opts.fresh)
        return []
      }
      return table === 'item' ? opts.visible.map((id) => ({ id })) : []
    }
    return c
  }
  const db = {
    selectFrom: (t: string) => chain(t, 'select'),
    insertInto: (t: string) => chain(t, 'insert'),
    updateTable: (t: string) => chain(t, 'update'),
    fn: { countAll: () => ({ as: () => 'n' }) },
  }
  return { db: db as unknown as Database, calls }
}

describe('recordViews', () => {
  it('counts only views that were new for the day', async () => {
    const { db, calls } = fakeDb({ recent: 0, visible: [A, B], fresh: [A] })
    const res = await recordViews(db, { viewerKey: 's:x', itemIds: [A, B] }, log)
    expect(res).toEqual({ recorded: 1, counted: [A], limited: false })
    expect(calls.updated).toHaveLength(1)
  })

  it('does not touch the counter when every view was a repeat', async () => {
    const { db, calls } = fakeDb({ recent: 0, visible: [A], fresh: [] })
    const res = await recordViews(db, { viewerKey: 's:x', itemIds: [A] }, log)
    expect(res.recorded).toBe(0)
    expect(calls.updated).toHaveLength(0)
  })

  it('rejects the batch once the hourly allowance is spent', async () => {
    const { db, calls } = fakeDb({ recent: VIEWS_PER_VIEWER_PER_HOUR, visible: [A], fresh: [A] })
    const res = await recordViews(db, { viewerKey: 's:x', itemIds: [A] }, log)
    expect(res).toEqual({ recorded: 0, counted: [], limited: true })
    expect(calls.inserted).toBe(0)
  })

  it('ignores items that are not visible reels', async () => {
    const { db, calls } = fakeDb({ recent: 0, visible: [], fresh: [A] })
    const res = await recordViews(db, { viewerKey: 's:x', itemIds: [A] }, log)
    expect(res.recorded).toBe(0)
    expect(calls.inserted).toBe(0)
  })
})
