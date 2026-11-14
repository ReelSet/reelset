import { describe, expect, it } from 'vitest'
import { validateUrls } from './urls'

describe('validateUrls', () => {
  it('accepts, trims and dedupes public urls', () => {
    const res = validateUrls([
      ' https://github.com/a/b ',
      'https://github.com/a/b#readme',
      'http://news.ycombinator.com/item?id=1',
    ])
    expect(res).toEqual({
      ok: true,
      urls: ['https://github.com/a/b', 'http://news.ycombinator.com/item?id=1'],
    })
  })

  it('rejects empty, non-array and over-limit input', () => {
    expect(validateUrls([]).ok).toBe(false)
    expect(validateUrls('https://a.com').ok).toBe(false)
    const six = Array.from({ length: 6 }, (_, i) => `https://example.com/${i}`)
    expect(validateUrls(six).ok).toBe(false)
    expect(validateUrls(six.slice(0, 5)).ok).toBe(true)
  })

  it.each([
    'ftp://example.com/x',
    'javascript:alert(1)',
    'file:///etc/passwd',
    'not a url',
    'http://localhost:3000',
    'http://app.localhost/x',
    'http://127.0.0.1/',
    'http://10.0.0.5/',
    'http://192.168.1.1/',
    'http://172.20.0.1/',
    'http://169.254.169.254/latest',
    'http://0x7f000001/',
    'http://2130706433/',
    'http://[::1]/',
    'http://[fd00::1]/',
    'http://intranet/',
    'http://db.internal/',
    'https://user:pw@example.com/',
  ])('rejects %s', (url) => {
    expect(validateUrls([url]).ok).toBe(false)
  })

  it('rejects non-string entries', () => {
    expect(validateUrls([42]).ok).toBe(false)
  })
})
