import { describe, expect, it } from 'vitest'
import { parseDemo } from './demo'

describe('parseDemo', () => {
  const url = 'https://github.com/user-attachments/assets/abc'
  it('adds the repo from the canonical url', () => {
    expect(parseDemo({ url, kind: 'mp4' }, 'https://github.com/acme/widget')).toEqual({
      url,
      kind: 'mp4',
      repo: 'acme/widget',
    })
  })

  it('ignores missing, non-https or non-github items', () => {
    expect(parseDemo(null, 'https://github.com/acme/widget')).toBeUndefined()
    expect(
      parseDemo({ url: 'http://x.com/a.gif', kind: 'gif' }, 'https://github.com/a/b'),
    ).toBeUndefined()
    expect(parseDemo({ url, kind: 'gif' }, 'https://news.example.com/a')).toBeUndefined()
    expect(parseDemo({ url, kind: 'avi' }, 'https://github.com/a/b')).toBeUndefined()
  })
})
