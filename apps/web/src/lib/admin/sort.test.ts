import { describe, expect, it } from 'vitest'
import { nextDir, parseSort, sortParams } from './sort'

const KEYS = ['changed', 'score', 'title'] as const
const DEFAULT = { key: 'changed', dir: 'desc' } as const

describe('parseSort', () => {
  it('falls back when nothing is given', () => {
    expect(parseSort({}, KEYS, DEFAULT)).toEqual(DEFAULT)
  })

  it('accepts whitelisted keys and directions', () => {
    expect(parseSort({ sort: 'score', dir: 'asc' }, KEYS, DEFAULT)).toEqual({
      key: 'score',
      dir: 'asc',
    })
  })

  it('rejects keys outside the whitelist, including injection attempts', () => {
    for (const bad of ['id; drop table item', 'score desc', '__proto__', 'constructor', '']) {
      expect(parseSort({ sort: bad, dir: 'asc' }, KEYS, DEFAULT)).toEqual(DEFAULT)
    }
  })

  it('uses the default direction when dir is invalid', () => {
    expect(parseSort({ sort: 'title', dir: 'sideways' }, KEYS, DEFAULT)).toEqual({
      key: 'title',
      dir: 'desc',
    })
  })

  it('takes the first value of repeated params', () => {
    expect(parseSort({ sort: ['title', 'score'], dir: ['asc', 'desc'] }, KEYS, DEFAULT)).toEqual({
      key: 'title',
      dir: 'asc',
    })
  })

  it('supports custom param names', () => {
    const names = { sort: 'ssort', dir: 'sdir' }
    expect(parseSort({ sort: 'score', ssort: 'title', sdir: 'asc' }, KEYS, DEFAULT, names)).toEqual(
      { key: 'title', dir: 'asc' },
    )
  })
})

describe('sortParams', () => {
  it('omits params for the default sort', () => {
    expect(sortParams(DEFAULT, DEFAULT)).toEqual({})
  })

  it('emits params otherwise', () => {
    expect(sortParams({ key: 'score', dir: 'asc' }, DEFAULT)).toEqual({ sort: 'score', dir: 'asc' })
  })
})

describe('nextDir', () => {
  it('starts at firstDir then toggles', () => {
    expect(nextDir(null, 'asc')).toBe('asc')
    expect(nextDir('asc', 'asc')).toBe('desc')
    expect(nextDir('desc', 'asc')).toBe('asc')
  })
})
