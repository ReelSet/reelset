import { describe, expect, it } from 'vitest'
import {
  edgeCacheKey,
  isEdgeCacheableRequest,
  isEdgeCacheableResponse,
  parseByteRange,
  withRange,
} from './edge-cache'

const ADMIN = 'admin.reelset.app'
const get = (path: string, headers: Record<string, string> = {}, host = 'reelset.app') =>
  new Request(`https://${host}${path}`, { headers })

describe('isEdgeCacheableRequest', () => {
  it('accepts anonymous GETs on the allowlisted paths', () => {
    for (const p of [
      '/api/reel/abc',
      '/api/avatar/x?v=1',
      '/api/showcase/1/preview',
      '/llms.txt',
      '/llms-full.txt',
    ]) {
      expect(isEdgeCacheableRequest(get(p), ADMIN)).toBe(true)
    }
  })

  it('rejects other paths, methods and the admin host', () => {
    expect(isEdgeCacheableRequest(get('/'), ADMIN)).toBe(false)
    expect(isEdgeCacheableRequest(get('/api/feed'), ADMIN)).toBe(false)
    expect(isEdgeCacheableRequest(get('/llms.txt.bak'), ADMIN)).toBe(false)
    expect(isEdgeCacheableRequest(get('/api/reel/abc', {}, ADMIN), ADMIN)).toBe(false)
    const post = new Request('https://reelset.app/api/reel/abc', { method: 'POST' })
    expect(isEdgeCacheableRequest(post, ADMIN)).toBe(false)
  })

  it('rejects signed-in, authorized and RSC requests', () => {
    const cookie = 'rs_auth=1; sb-abcd-auth-token=base64-x'
    expect(isEdgeCacheableRequest(get('/api/reel/a', { cookie }), ADMIN)).toBe(false)
    expect(isEdgeCacheableRequest(get('/api/reel/a', { authorization: 'Bearer k' }), ADMIN)).toBe(
      false,
    )
    expect(isEdgeCacheableRequest(get('/api/reel/a', { rsc: '1' }), ADMIN)).toBe(false)
    expect(isEdgeCacheableRequest(get('/api/reel/a', { cookie: 'rs_tz=UTC' }), ADMIN)).toBe(true)
  })

  it('works without an admin host configured', () => {
    expect(isEdgeCacheableRequest(get('/api/reel/a', {}, ADMIN), undefined)).toBe(true)
  })
})

describe('isEdgeCacheableResponse', () => {
  const res = (status: number, headers: Record<string, string>) =>
    new Response('x', { status, headers })
  const cc = 'public, max-age=300, s-maxage=3600'

  it('needs a 200, public and s-maxage, and no cookie', () => {
    expect(isEdgeCacheableResponse(res(200, { 'cache-control': cc }))).toBe(true)
    expect(isEdgeCacheableResponse(res(404, { 'cache-control': cc }))).toBe(false)
    expect(isEdgeCacheableResponse(res(200, { 'cache-control': 'public, max-age=60' }))).toBe(false)
    expect(isEdgeCacheableResponse(res(200, { 'cache-control': 'private, no-store' }))).toBe(false)
    expect(isEdgeCacheableResponse(res(200, {}))).toBe(false)
    expect(isEdgeCacheableResponse(res(200, { 'cache-control': cc, 'set-cookie': 'a=b' }))).toBe(
      false,
    )
  })
})

describe('edgeCacheKey', () => {
  it('sorts the query and drops headers and the fragment', () => {
    const a = get('/api/avatar/x?v=2&a=1#f', { range: 'bytes=0-1', cookie: 'rs_tz=UTC' })
    expect(edgeCacheKey(a)).toBe('https://reelset.app/api/avatar/x?a=1&v=2')
    expect(edgeCacheKey(get('/llms.txt'))).toBe('https://reelset.app/llms.txt')
  })
})

describe('parseByteRange', () => {
  it('handles open, closed and suffix ranges', () => {
    expect(parseByteRange('bytes=0-1', 10)).toEqual({ start: 0, end: 1 })
    expect(parseByteRange('bytes=4-', 10)).toEqual({ start: 4, end: 9 })
    expect(parseByteRange('bytes=-3', 10)).toEqual({ start: 7, end: 9 })
    expect(parseByteRange('bytes=5-99', 10)).toEqual({ start: 5, end: 9 })
  })

  it('rejects multi-part, malformed and unsatisfiable ranges', () => {
    expect(parseByteRange('bytes=0-1,4-5', 10)).toBeNull()
    expect(parseByteRange('items=0-1', 10)).toBeNull()
    expect(parseByteRange('bytes=-', 10)).toBeNull()
    expect(parseByteRange('bytes=10-', 10)).toBeNull()
    expect(parseByteRange('bytes=5-2', 10)).toBeNull()
  })
})

describe('withRange', () => {
  const full = () =>
    new Response('0123456789', { headers: { 'content-type': 'video/mp4', 'x-edge-cache': 'HIT' } })

  it('returns the response untouched without a Range header or for a non-200', async () => {
    const res = full()
    expect(await withRange(res, null)).toBe(res)
    const partial = new Response('x', { status: 206 })
    expect(await withRange(partial, 'bytes=0-0')).toBe(partial)
  })

  it('slices a 206 with content-range and keeps the other headers', async () => {
    const res = await withRange(full(), 'bytes=2-4')
    expect(res.status).toBe(206)
    expect(await res.text()).toBe('234')
    expect(res.headers.get('content-range')).toBe('bytes 2-4/10')
    expect(res.headers.get('content-length')).toBe('3')
    expect(res.headers.get('content-type')).toBe('video/mp4')
    expect(res.headers.get('x-edge-cache')).toBe('HIT')
  })

  it('answers 416 for an unsatisfiable range', async () => {
    const res = await withRange(full(), 'bytes=20-')
    expect(res.status).toBe(416)
    expect(res.headers.get('content-range')).toBe('bytes */10')
  })
})
