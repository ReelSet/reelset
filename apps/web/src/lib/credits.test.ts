import { describe, expect, it } from 'vitest'
import { toCreditsDto } from './credits'

const ann = {
  kind: 'stock',
  provider: 'pexels',
  creator: 'Ann Lee',
  creatorUrl: 'https://www.pexels.com/@ann',
  url: 'https://www.pexels.com/video/code-on-screen-123/',
}

describe('toCreditsDto', () => {
  it('returns null when there is nothing to credit', () => {
    expect(toCreditsDto(null)).toBeNull()
    expect(toCreditsDto(undefined)).toBeNull()
    expect(toCreditsDto([])).toBeNull()
    expect(toCreditsDto({ kind: 'stock' })).toBeNull()
    expect(toCreditsDto('not json')).toBeNull()
  })

  it('maps stock clips and the demo from the render jsonb', () => {
    expect(
      toCreditsDto([
        ann,
        { kind: 'demo', repo: 'acme/widget', url: 'https://github.com/acme/widget' },
      ]),
    ).toEqual({
      stock: [{ creator: 'Ann Lee', url: 'https://www.pexels.com/video/code-on-screen-123/' }],
      demo: { repo: 'acme/widget', url: 'https://github.com/acme/widget' },
    })
  })

  it('accepts the jsonb as a JSON string', () => {
    expect(toCreditsDto(JSON.stringify([ann]))?.stock).toHaveLength(1)
  })

  it('falls back to the creator page and tolerates a missing creator', () => {
    expect(
      toCreditsDto([
        { kind: 'stock', provider: 'pexels', creator: null, creatorUrl: ann.creatorUrl },
      ]),
    ).toEqual({ stock: [{ creator: null, url: 'https://www.pexels.com/@ann' }], demo: null })
  })

  it('dedupes clips and drops unsafe or unknown entries', () => {
    const dto = toCreditsDto([
      ann,
      ann,
      { kind: 'stock', provider: 'pexels', creator: 'Eve', url: 'javascript:alert(1)' },
      { kind: 'stock', provider: 'other', creator: 'Bob', url: 'https://example.com/v' },
      { kind: 'music', url: 'https://example.com' },
      42,
    ])
    expect(dto).toEqual({ stock: [{ creator: 'Ann Lee', url: ann.url }], demo: null })
  })

  it('builds the demo link from a valid repo only', () => {
    expect(toCreditsDto([{ kind: 'demo', repo: 'evil.com/../x y' }])).toBeNull()
    expect(
      toCreditsDto([{ kind: 'demo', repo: 'octo/hello.js', url: 'https://evil.com' }]),
    ).toEqual({
      stock: [],
      demo: { repo: 'octo/hello.js', url: 'https://github.com/octo/hello.js' },
    })
  })
})
