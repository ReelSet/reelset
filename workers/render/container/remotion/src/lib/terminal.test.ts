import { describe, expect, it } from 'vitest'
import { buildSession, fitSessionFont, outputFor, revealSession, sessionFont, sessionLineCount } from './terminal'

describe('outputFor', () => {
  it('derives the clone directory and prints only generic progress', () => {
    expect(outputFor('git clone https://github.com/acme/widget.git')).toEqual([
      "Cloning into 'widget'...",
      'Receiving objects: 100%, done.',
      'Resolving deltas: 100%, done.',
    ])
    expect(outputFor('git clone git@github.com:acme/widget.git mydir')[0]).toBe("Cloning into 'mydir'...")
  })

  it('never invents versions, counts or listings', () => {
    for (const cmd of ['pip install foo', 'npm install', 'cargo install bar', 'brew install baz']) {
      expect(outputFor(cmd).join('\n')).not.toMatch(/\d+\.\d+|\d+ packages|vulnerabilit/i)
    }
    expect(outputFor('ls')).toEqual([])
    expect(outputFor('./run-it --fast')).toEqual([])
  })

  it('names the package the user typed', () => {
    expect(outputFor('pip install fastkit')).toContain('Successfully installed fastkit')
    expect(outputFor('npx create-thing@latest')[1]).toBe('create-thing@latest')
  })
})

describe('buildSession', () => {
  it('uses the given commands', () => {
    const rows = buildSession(['pip install fastkit'], {})
    expect(rows).toHaveLength(1)
    expect(rows[0]!.out.length).toBeGreaterThan(1)
  })

  it('falls back to clone and cd from the repo identity, adding the real latest release', () => {
    const rows = buildSession([], { owner: 'acme', name: 'widget', latestRelease: 'v1.4.2' })
    expect(rows.map((r) => r.cmd)).toEqual([
      'git clone https://github.com/acme/widget',
      'cd widget',
      'git describe --tags --abbrev=0',
    ])
    expect(rows[2]!.out).toEqual(['v1.4.2'])
  })

  it('is empty when nothing is known', () => {
    expect(buildSession([], {})).toEqual([])
  })
})

describe('revealSession', () => {
  const rows = buildSession(['pip install fastkit', 'echo hi'], {})
  it('types the first command before showing its output', () => {
    expect(revealSession(rows, 5)[0]).toEqual({ typed: 5, shown: 0 })
    expect(revealSession(rows, 0)[1]!.typed).toBe(0)
  })
  it('shows all output once everything is typed', () => {
    const r = revealSession(rows, 1000)
    expect(r[0]!.shown).toBe(rows[0]!.out.length)
    expect(r[1]!.typed).toBe(rows[1]!.cmd.length)
  })
})

describe('sessionFont', () => {
  it('grows for short sessions and shrinks for long ones within bounds', () => {
    expect(sessionFont(4, 800)).toBeGreaterThan(sessionFont(10, 800))
    expect(sessionFont(1, 800)).toBeLessThanOrEqual(64)
    expect(sessionFont(40, 800)).toBe(38)
    expect(sessionLineCount([{ cmd: 'a', out: ['b', 'c'] }])).toBe(4)
  })
})

describe('fitSessionFont', () => {
  it('shrinks when long lines wrap', () => {
    const short = [{ cmd: 'ls', out: ['a'] }]
    const long = [{ cmd: 'git clone https://github.com/heydamir/unslop.git', out: ['x'.repeat(80)] }]
    expect(fitSessionFont(long, 960, 400)).toBeLessThan(fitSessionFont(short, 960, 400))
  })
})
