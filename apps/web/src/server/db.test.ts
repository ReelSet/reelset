import { describe, expect, it, vi } from 'vitest'
import type { createDb } from '@reelset/core'
import { dbFor, resolveDbSource } from './db'

const hyperdriveCtx = (ctx: object = {}) => ({
  env: { HYPERDRIVE: { connectionString: 'postgres://hyperdrive' } },
  ctx,
})

function fakeCreate() {
  return vi.fn(((opts: { connectionString: string }) => ({
    db: { url: opts.connectionString } as never,
    close: async () => {},
  })) as unknown as typeof createDb)
}

describe('resolveDbSource', () => {
  it('prefers the Hyperdrive binding inside a Workers request', () => {
    const ctx = {}
    expect(resolveDbSource(hyperdriveCtx(ctx), { DATABASE_URL: 'postgres://env' })).toEqual({
      kind: 'hyperdrive',
      connectionString: 'postgres://hyperdrive',
      key: ctx,
    })
  })

  it('falls back to DATABASE_URL outside Workers or without the binding', () => {
    const env = { DATABASE_URL: 'postgres://env' }
    expect(resolveDbSource(undefined, env)).toEqual({
      kind: 'env',
      connectionString: 'postgres://env',
    })
    expect(resolveDbSource({ env: {}, ctx: {} }, env)).toMatchObject({ kind: 'env' })
  })

  it('throws when neither source is configured', () => {
    expect(() => resolveDbSource(undefined, {})).toThrow('DATABASE_URL')
  })
})

describe('dbFor', () => {
  it('builds one client per request context and never shares it across requests', () => {
    const create = fakeCreate()
    const a = resolveDbSource(hyperdriveCtx({}), {})
    const b = resolveDbSource(hyperdriveCtx({}), {})
    expect(dbFor(a, create)).toBe(dbFor(a, create))
    expect(dbFor(b, create)).not.toBe(dbFor(a, create))
    expect(create).toHaveBeenCalledTimes(2)
  })
})
