import { describe, expect, it } from 'vitest'
import { KIT_NAMES } from './api-doc'
import { loadScript } from './sandbox'

const kit: Record<string, unknown> = Object.fromEntries(
  KIT_NAMES.map((n) => [n, n === 'COL' ? { ink: '#000' } : () => n]),
)
const DATA = { title: 'x', words: [['a', 0.1]] }
const load = (code: string, timeout?: number) => loadScript(code, DATA, kit, timeout)

describe('loadScript', () => {
  it('returns what the script returns and exposes DATA and the kit', () => {
    const out = load('return [{ t0: 0, title: DATA.title, ink: COL.ink, c: clamp() }]') as unknown[]
    expect(out).toEqual([{ t0: 0, title: 'x', ink: '#000', c: 'clamp' }])
  })

  it('loads a script that redeclares a kit name', () => {
    expect(load('const bg = "#fff"\nconst COL = 2\nreturn [bg, COL]')).toEqual(['#fff', 2])
  })

  it('cannot see process, require or the host globals', () => {
    const out = load(
      'return [typeof process, typeof require, typeof module, typeof fetch, typeof globalThis.process, typeof Buffer]',
    )
    expect(out).toEqual([
      'undefined',
      'undefined',
      'undefined',
      'undefined',
      'undefined',
      'undefined',
    ])
  })

  it('does not leak host environment variables through globalThis', () => {
    process.env.DIRECTOR_TEST_SECRET = 'hunter2'
    try {
      const out = load('return Object.keys(globalThis).join(",") + JSON.stringify(DATA)') as string
      expect(out).not.toContain('hunter2')
      expect(out.split('{')[0]).toContain('DATA')
    } finally {
      delete process.env.DIRECTOR_TEST_SECRET
    }
  })

  it('blocks string code generation inside the context', () => {
    expect(() => load("return Function('return 1')()")).toThrow(/code generation/i)
    expect(() => load("return eval('1')")).toThrow(/code generation/i)
    expect(() => load("return (() => 1).constructor('return 1')()")).toThrow(/code generation/i)
  })

  it('times out a script that never finishes loading', () => {
    expect(() => load('while (true) {}', 50)).toThrow(/timed out/i)
  })

  it('reports syntax errors', () => {
    expect(() => load('return [')).toThrow(SyntaxError)
  })
})
