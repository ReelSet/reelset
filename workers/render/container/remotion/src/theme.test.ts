import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { FONT, MONO } from './theme'

describe('font stacks', () => {
  it('fall back to a CJK family after the Latin fonts, before the generic family', () => {
    for (const stack of [FONT, MONO]) {
      expect(stack.indexOf('Noto Sans CJK SC')).toBeGreaterThan(stack.indexOf('Geist'))
      expect(stack).toMatch(/Noto Sans CJK SC.*(?:sans-serif|monospace)$/)
    }
  })

  it('ships the font in the container image', () => {
    const dockerfile = readFileSync(new URL('../../Dockerfile', import.meta.url), 'utf8')
    expect(dockerfile).toContain('fonts-noto-cjk')
  })
})
