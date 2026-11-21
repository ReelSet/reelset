import { describe, expect, it } from 'vitest'
import { isUnknownSourcePath, sourceRewritePath } from './source-path'

describe('sourceRewritePath', () => {
  it('maps the topics index and a topic page to their source segment', () => {
    expect(sourceRewritePath('/t', 'github')).toBe('/t/by/github')
    expect(sourceRewritePath('/t/rust', 'hn')).toBe('/t/rust/by/hn')
  })

  it('leaves other paths and missing sources alone', () => {
    expect(sourceRewritePath('/t', null)).toBeNull()
    expect(sourceRewritePath('/t', '')).toBeNull()
    expect(sourceRewritePath('/', 'github')).toBeNull()
    expect(sourceRewritePath('/r/x-1a2b3c4d', 'github')).toBeNull()
    expect(sourceRewritePath('/t/', 'github')).toBeNull()
    expect(sourceRewritePath('/t/rust/by/hn', 'github')).toBeNull()
  })

  it('rejects values that cannot be a source', () => {
    expect(sourceRewritePath('/t', 'GitHub')).toBeNull()
    expect(sourceRewritePath('/t', '../admin')).toBeNull()
    expect(sourceRewritePath('/t', 'x')).toBeNull()
  })
})

describe('unknown sources', () => {
  it('does not rewrite a made-up ?source=', () => {
    expect(sourceRewritePath('/t', 'zz')).toBeNull()
    expect(sourceRewritePath('/t/rust', 'abcdefgh')).toBeNull()
  })

  it('flags direct hits on a made-up source segment only', () => {
    expect(isUnknownSourcePath('/t/by/zz')).toBe(true)
    expect(isUnknownSourcePath('/t/rust/by/abcdefgh')).toBe(true)
    expect(isUnknownSourcePath('/t/by/github')).toBe(false)
    expect(isUnknownSourcePath('/t/rust/by/hn')).toBe(false)
    expect(isUnknownSourcePath('/t/rust')).toBe(false)
    expect(isUnknownSourcePath('/t/by')).toBe(false)
  })
})
