import { describe, expect, it } from 'vitest'
import { decryptJson, encryptJson, importSessionKey } from './crypto'

const KEY_B64 = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)))

describe('session crypto', () => {
  it('round-trips and never contains the plaintext', async () => {
    const key = await importSessionKey(KEY_B64)
    const blob = await encryptJson(key, { sessionid: 'secret-value' })
    expect(blob.startsWith('v1.')).toBe(true)
    expect(blob).not.toContain('secret-value')
    expect(await decryptJson(key, blob)).toEqual({ sessionid: 'secret-value' })
  })

  it('uses a fresh iv every time', async () => {
    const key = await importSessionKey(KEY_B64)
    expect(await encryptJson(key, { a: 1 })).not.toBe(await encryptJson(key, { a: 1 }))
  })

  it('rejects a tampered blob and a wrong key', async () => {
    const key = await importSessionKey(KEY_B64)
    const other = await importSessionKey(btoa(String.fromCharCode(...new Uint8Array(32).fill(9))))
    const blob = await encryptJson(key, { a: 1 })
    await expect(decryptJson(other, blob)).rejects.toThrow()
    await expect(decryptJson(key, `${blob.slice(0, -4)}AAAA`)).rejects.toThrow()
    await expect(decryptJson(key, 'garbage')).rejects.toThrow()
  })

  it('rejects keys that are not 32 bytes', async () => {
    await expect(importSessionKey(btoa('short'))).rejects.toThrow('32 bytes')
  })
})
