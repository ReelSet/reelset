import pino from 'pino'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import type { Database } from '@reelset/core'
import { AVATAR_MAX_BYTES } from '@/lib/profile-edit'
import { removeAvatar, saveAvatar, saveDetails } from './profile-edit'

const log = pino({ level: 'silent' })

function fakeDb(opts: { claim?: boolean } = {}) {
  const calls: { op: string; values?: unknown }[] = []
  const chain = (op: string) => {
    const c: Record<string, unknown> = {}
    for (const m of ['set', 'where', 'returning', 'onConflict']) {
      c[m] = (v?: unknown) => {
        if (m === 'set') calls.push({ op, values: v })
        return c
      }
    }
    c['values'] = (v: unknown) => {
      calls.push({ op: `${op}:values`, values: v })
      return c
    }
    c['execute'] = async () => []
    c['executeTakeFirst'] = async () => (opts.claim === false ? undefined : { id: 'p' })
    return c
  }
  const db = {
    updateTable: () => chain('update'),
    insertInto: () => chain('insert'),
    deleteFrom: () => chain('delete'),
    transaction: () => ({ execute: async (fn: (t: unknown) => unknown) => fn(db) }),
  }
  return { db: db as unknown as Database, calls }
}

async function png(w = 600, h = 300) {
  return sharp({ create: { width: w, height: h, channels: 3, background: '#c8f751' } })
    .png()
    .toBuffer()
}

describe('saveDetails', () => {
  it('stores a trimmed name and bio', async () => {
    const { db, calls } = fakeDb()
    const res = await saveDetails(db, 'p', { name: ' Ada ', bio: ' hi ' }, log)
    expect(res).toEqual({ ok: true, value: { name: 'Ada', bio: 'hi' } })
    expect(calls.some((c) => (c.values as { display_name?: string })?.display_name === 'Ada')).toBe(
      true,
    )
  })

  it('rejects invalid bodies without touching the db', async () => {
    const { db, calls } = fakeDb()
    expect(await saveDetails(db, 'p', { name: '' }, log)).toEqual({ ok: false, error: 'invalid' })
    expect(await saveDetails(db, 'p', null, log)).toEqual({ ok: false, error: 'invalid' })
    expect(calls).toHaveLength(0)
  })

  it('reports rate limiting when the edit window is spent', async () => {
    const { db } = fakeDb({ claim: false })
    expect(await saveDetails(db, 'p', { name: 'Ada' }, log)).toEqual({
      ok: false,
      error: 'rate_limited',
    })
  })
})

describe('saveAvatar', () => {
  it('re-encodes a valid image to a 256px square webp', async () => {
    const { db, calls } = fakeDb()
    expect(await saveAvatar(db, 'p', await png(), log)).toEqual({ ok: true, value: undefined })
    const insert = calls.find((c) => c.op === 'insert:values')!.values as {
      bytes: Buffer
      content_type: string
    }
    const meta = await sharp(insert.bytes).metadata()
    expect([meta.format, meta.width, meta.height]).toEqual(['webp', 256, 256])
    expect(insert.content_type).toBe('image/webp')
  })

  it('rejects oversized, empty, non-image and corrupt uploads', async () => {
    const { db, calls } = fakeDb()
    expect(await saveAvatar(db, 'p', new Uint8Array(AVATAR_MAX_BYTES + 1), log)).toMatchObject({
      error: 'too_large',
    })
    expect(await saveAvatar(db, 'p', new Uint8Array(0), log)).toMatchObject({ error: 'invalid' })
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>')
    expect(await saveAvatar(db, 'p', svg, log)).toMatchObject({ error: 'unsupported' })
    const corrupt = Uint8Array.from([0xff, 0xd8, 0xff, 1, 2, 3, 4])
    expect(await saveAvatar(db, 'p', corrupt, log)).toMatchObject({ error: 'unsupported' })
    expect(calls).toHaveLength(0)
  })

  it('does not write when rate limited', async () => {
    const { db, calls } = fakeDb({ claim: false })
    expect(await saveAvatar(db, 'p', await png(), log)).toMatchObject({ error: 'rate_limited' })
    expect(calls.some((c) => c.op === 'insert:values')).toBe(false)
  })
})

describe('removeAvatar', () => {
  it('deletes the row and hides the provider avatar', async () => {
    const { db, calls } = fakeDb()
    expect(await removeAvatar(db, 'p', log)).toEqual({ ok: true, value: undefined })
    expect(
      calls.some((c) => (c.values as { avatar_hidden?: boolean })?.avatar_hidden === true),
    ).toBe(true)
  })
})
