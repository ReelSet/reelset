import { describe, expect, it } from 'vitest'
import { sourceRewritePath } from './source-path'

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
