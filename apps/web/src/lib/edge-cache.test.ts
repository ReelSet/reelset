import { describe, expect, it } from 'vitest'
import { edgeCacheKey, isEdgeCacheableRequest, isEdgeCacheableResponse } from './edge-cache'

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
