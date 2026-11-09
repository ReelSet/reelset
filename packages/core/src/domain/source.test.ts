import pino from 'pino'
import { describe, expect, it, vi } from 'vitest'
import { SOURCES, parseSource } from './source'

const log = pino({ level: 'silent' })

describe('parseSource', () => {
  it('accepts exactly the five known sources', () => {
    expect([...SOURCES].sort()).toEqual(['github', 'hn', 'news', 'reddit', 'youtube'])
    for (const source of SOURCES) expect(parseSource(source, log)).toBe(source)
  })

  it('rejects unknown, cased, or non-string values instead of defaulting', () => {
    for (const value of ['video', 'HN', 'hacker_news', '', null, undefined, 42, {}]) {
      expect(parseSource(value, log)).toBeNull()
    }
  })

  it('logs each rejection with a truncated value', () => {
    const warn = vi.fn()
    const spy = { warn } as unknown as typeof log
    parseSource('x'.repeat(200), spy)
    expect(warn).toHaveBeenCalledOnce()
    const [fields] = warn.mock.calls[0]!
    expect((fields as { value: string }).value).toHaveLength(64)
  })
})
