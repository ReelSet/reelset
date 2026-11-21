import pino from 'pino'
import { describe, expect, it } from 'vitest'
import type { Database } from '@reelset/core'
import { AVATAR_STORED_MAX_BYTES } from '@/lib/profile-edit'
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

/** A VP8X WebP header; the server reads only the header, so no pixel data is needed. */
function webp(w = 256, h = 256) {
  const le24 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff]
  const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0))
  const out = Uint8Array.from([
    ...ascii('RIFF'),
    0,
    0,
    0,
    0,
    ...ascii('WEBPVP8X'),
    10,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    ...le24(w - 1),
    ...le24(h - 1),
    ...new Array(16).fill(0),
  ])
  new DataView(out.buffer).setUint32(4, out.length - 8, true)
  return out
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
  it('stores a square webp of at most 256 px as uploaded', async () => {
    const { db, calls } = fakeDb()
    const body = webp()
    expect(await saveAvatar(db, 'p', body, log)).toEqual({ ok: true, value: undefined })
    const insert = calls.find((c) => c.op === 'insert:values')!.values as {
      bytes: Buffer
      content_type: string
    }
    expect(Buffer.compare(insert.bytes, Buffer.from(body))).toBe(0)
    expect(insert.content_type).toBe('image/webp')
  })

  it('keeps the sniffed type for the Safari JPEG fallback', async () => {
    const { db, calls } = fakeDb()
    const jpeg = Uint8Array.from([
      ...[0xff, 0xd8, 0xff, 0xc0, 0, 11, 8, 0, 128, 0, 128, 1, 1, 0x11, 0],
      ...[0xff, 0xda, 0, 8, 1, 1, 0, 0, 0x3f, 0, 0x12, 0x34, 0xff, 0xd9],
    ])
    expect(await saveAvatar(db, 'p', jpeg, log)).toEqual({ ok: true, value: undefined })
    const insert = calls.find((c) => c.op === 'insert:values')!.values as { content_type: string }
    expect(insert.content_type).toBe('image/jpeg')
  })

  it('rejects images that are not a small square', async () => {
    const { db, calls } = fakeDb()
    expect(await saveAvatar(db, 'p', webp(600, 300), log)).toMatchObject({ error: 'unsupported' })
    expect(await saveAvatar(db, 'p', webp(512, 512), log)).toMatchObject({ error: 'unsupported' })
    expect(calls).toHaveLength(0)
  })

  it('rejects oversized, empty, non-image and corrupt uploads', async () => {
    const { db, calls } = fakeDb()
    expect(
      await saveAvatar(db, 'p', new Uint8Array(AVATAR_STORED_MAX_BYTES + 1), log),
    ).toMatchObject({
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
    expect(await saveAvatar(db, 'p', webp(), log)).toMatchObject({ error: 'rate_limited' })
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

describe('saveAvatar metadata', () => {
  it('strips EXIF before storing an upload that skipped the browser re-encode', async () => {
    const { db, calls } = fakeDb()
    const exif = [...'Exif\0\0GPSLatitude'].map((c) => c.charCodeAt(0))
    const jpeg = Uint8Array.from([
      ...[0xff, 0xd8, 0xff, 0xe1, 0, exif.length + 2, ...exif],
      ...[0xff, 0xc0, 0, 11, 8, 0, 128, 0, 128, 1, 1, 0x11, 0],
      ...[0xff, 0xda, 0, 8, 1, 1, 0, 0, 0x3f, 0, 0x12, 0x34, 0xff, 0xd9],
    ])
    expect(await saveAvatar(db, 'p', jpeg, log)).toEqual({ ok: true, value: undefined })
    const insert = calls.find((c) => c.op === 'insert:values')!.values as { bytes: Buffer }
    expect(insert.bytes.includes(Buffer.from('GPSLatitude'))).toBe(false)
    expect(insert.bytes.length).toBe(jpeg.length - exif.length - 4)
  })
})
