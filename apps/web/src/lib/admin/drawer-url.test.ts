import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  adminReturnPath,
  drawerHash,
  drawerParam,
  readDrawerHash,
  parseDrawerId,
  readDrawerRef,
  withDrawerRef,
} from './drawer-url'

const ID = '3f2c1f0e-7a7e-4d57-9a54-0d3f3a2b9c11'
const OTHER = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d'

describe('parseDrawerId', () => {
  it('accepts exactly what the API route accepts (z.guid)', () => {
    for (const value of [ID, ID.toUpperCase(), 'nope', '', `${ID}x`, `x${ID}`, null, 42]) {
      expect(parseDrawerId(value) !== null).toBe(z.guid().safeParse(value).success)
    }
  })
})

describe('drawerParam', () => {
  it('uses item and user by default', () => {
    expect(drawerParam('item', '/admin/pipeline')).toBe('item')
    expect(drawerParam('user', '/admin/users')).toBe('user')
  })

  it('avoids the Instagram composer param, with or without the /admin prefix', () => {
    expect(drawerParam('item', '/admin/instagram')).toBe('drawer')
    expect(drawerParam('item', '/instagram/')).toBe('drawer')
  })
})

describe('readDrawerRef', () => {
  it('reads item and user refs', () => {
    expect(readDrawerRef(`?item=${ID}`, '/admin/pipeline')).toEqual({ kind: 'item', id: ID })
    expect(readDrawerRef(`?q=a&user=${ID}`, '/admin/users')).toEqual({ kind: 'user', id: ID })
  })

  it('ignores invalid ids and the Instagram composer item', () => {
    expect(readDrawerRef('?item=nope', '/admin/pipeline')).toBeNull()
    expect(readDrawerRef(`?item=${ID}`, '/admin/instagram')).toBeNull()
    expect(readDrawerRef(`?drawer=${ID}`, '/admin/instagram')).toEqual({ kind: 'item', id: ID })
    expect(readDrawerRef('', '/admin/pipeline')).toBeNull()
  })
})

describe('withDrawerRef', () => {
  it('sets the ref and keeps other params', () => {
    const next = withDrawerRef('?status=failed&page=2', '/admin/pipeline', { kind: 'item', id: ID })
    expect(new URLSearchParams(next).get('item')).toBe(ID)
    expect(new URLSearchParams(next).get('status')).toBe('failed')
  })

  it('replaces an open ref and clears it on close', () => {
    const open = withDrawerRef(`?item=${ID}`, '/admin/pipeline', { kind: 'item', id: OTHER })
    expect(open).toBe(`?item=${OTHER}`)
    expect(withDrawerRef(`?item=${ID}&q=x`, '/admin/pipeline', null)).toBe('?q=x')
    expect(withDrawerRef(`?item=${ID}`, '/admin/pipeline', null)).toBe('')
  })
})

describe('adminReturnPath', () => {
  it('restores the /admin prefix the admin host hides', () => {
    expect(adminReturnPath('/pipeline', '?item=a')).toBe('/admin/pipeline?item=a')
    expect(adminReturnPath('/', '')).toBe('/admin')
    expect(adminReturnPath('/admin/users', '?user=a')).toBe('/admin/users?user=a')
  })
})

describe('drawer hash', () => {
  it('round-trips a ref through the hash', () => {
    expect(drawerHash({ kind: 'item', id: ID })).toBe(`#item=${ID}`)
    expect(readDrawerHash(`#item=${ID}`)).toEqual({ kind: 'item', id: ID })
    expect(readDrawerHash(`#user=${ID}`)).toEqual({ kind: 'user', id: ID })
    expect(drawerHash(null)).toBe('')
  })

  it('ignores anything that is not a drawer ref', () => {
    expect(readDrawerHash('')).toBeNull()
    expect(readDrawerHash('#recent')).toBeNull()
    expect(readDrawerHash('#item=nope')).toBeNull()
  })
})
