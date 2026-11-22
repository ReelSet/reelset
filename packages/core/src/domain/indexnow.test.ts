import { describe, expect, it, vi } from 'vitest'
import { createLogger } from '../lib/logger'
import {
  INDEXNOW_ENDPOINT,
  INDEXNOW_KEY,
  reelPath,
  reelUrl,
  slugify,
  submitIndexNow,
} from './indexnow'

const log = createLogger({ app: 'test', level: 'silent' })
const id = '218507c9-44e9-4128-aa63-9ecfb83a7d81'

describe('reelPath', () => {
  it('builds the canonical slug-shortid path', () => {
    expect(
      reelPath({ id, title: 'Are we not allowed to ask any sh*t about biology to Opus 5.5?' }),
    ).toBe('/r/are-we-not-allowed-to-ask-any-sh-t-about-biology-to-opus-5-5-218507c9')
    expect(reelUrl({ id, title: '' })).toBe('https://reelset.app/r/218507c9')
  })

  it('cuts long titles at a word boundary', () => {
    expect(slugify('a'.repeat(40) + ' ' + 'b'.repeat(40))).toBe('a'.repeat(40))
  })
})

describe('submitIndexNow', () => {
  const ok = () => vi.fn(async () => new Response(null, { status: 202 }))

  it('posts only unique reelset.app urls with the key and its location', async () => {
    const fetchImpl = ok()
    const url = reelUrl({ id, title: 'x' })
    const result = await submitIndexNow(
      [url, url, 'https://evil.example/r/x', 'nope'],
      log,
      fetchImpl,
    )
    expect(result).toBe('sent')
    expect(fetchImpl).toHaveBeenCalledOnce()
    const [endpoint, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(endpoint).toBe(INDEXNOW_ENDPOINT)
    expect(JSON.parse(init.body as string)).toEqual({
      host: 'reelset.app',
      key: INDEXNOW_KEY,
      keyLocation: 'https://reelset.app/indexnow-key.txt',
      urlList: [url],
    })
  })

  it('skips the request when nothing is left to send', async () => {
    const fetchImpl = ok()
    expect(await submitIndexNow(['https://other.dev/a'], log, fetchImpl)).toBe('empty')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('reports rejections and network errors without throwing', async () => {
    const rejected = vi.fn(async () => new Response('bad key', { status: 403 }))
    expect(await submitIndexNow([reelUrl({ id })], log, rejected)).toBe('rejected')
    const broken = vi.fn(async () => {
      throw new Error('offline')
    })
    expect(await submitIndexNow([reelUrl({ id })], log, broken)).toBe('failed')
  })
})
