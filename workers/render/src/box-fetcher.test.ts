import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBoxFetcher } from './box-fetcher'
import { createContainerClient } from './container-client'
import { silentLog } from './testing'

type Call = { url: string; init: RequestInit & { headers: Headers } }

function stubFetch(respond: () => Response = () => new Response('ok')) {
  const calls: Call[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: URL | string, init: RequestInit & { headers: Headers }) => {
      calls.push({ url: String(url), init })
      return respond()
    }),
  )
  return calls
}

const box = () =>
  createBoxFetcher({ baseUrl: 'https://box.example.test', token: 'secret-token', log: silentLog })

afterEach(() => vi.unstubAllGlobals())

describe('createBoxFetcher', () => {
  it('rewrites the internal host and keeps path and query', async () => {
    const calls = stubFetch()
    await box().fetch(new Request('http://container/render/abc/video?x=1'))
    expect(calls[0]!.url).toBe('https://box.example.test/render/abc/video?x=1')
  })

  it('adds the bearer token and keeps the caller headers', async () => {
    const calls = stubFetch()
    await box().fetch(new Request('http://container/health', { headers: { 'x-trace': 't1' } }))
    const headers = calls[0]!.init.headers
    expect(headers.get('authorization')).toBe('Bearer secret-token')
    expect(headers.get('x-trace')).toBe('t1')
  })

  it('overrides a caller supplied authorization header', async () => {
    const calls = stubFetch()
    await box().fetch(
      new Request('http://container/health', { headers: { authorization: 'Bearer other' } }),
    )
    expect(calls[0]!.init.headers.get('authorization')).toBe('Bearer secret-token')
  })

  it('forwards method, body and content type', async () => {
    const calls = stubFetch()
    await box().fetch(
      new Request('http://container/render', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jobId: 'j' }),
      }),
    )
    const { init } = calls[0]!
    expect(init.method).toBe('POST')
    expect(init.headers.get('content-type')).toBe('application/json')
    expect(new TextDecoder().decode(init.body as ArrayBuffer)).toBe('{"jobId":"j"}')
  })

  it('sends no body for GET and DELETE', async () => {
    const calls = stubFetch()
    await box().fetch(new Request('http://container/render/j', { method: 'DELETE' }))
    expect(calls[0]!.init.method).toBe('DELETE')
    expect(calls[0]!.init.body).toBeUndefined()
  })

  it('passes the abort signal through', async () => {
    const calls = stubFetch()
    const controller = new AbortController()
    await box().fetch(new Request('http://container/health', { signal: controller.signal }))
    controller.abort()
    expect(calls[0]!.init.signal?.aborted).toBe(true)
  })

  it('refuses to send the token to any other host', async () => {
    const calls = stubFetch()
    await expect(box().fetch(new Request('https://evil.example.test/x'))).rejects.toThrow(
      /only serves/,
    )
    expect(calls).toEqual([])
  })

  it('lets network errors reach the caller', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('connection refused')))
    await expect(box().fetch(new Request('http://container/health'))).rejects.toThrow(
      'connection refused',
    )
  })
})

describe('fallback box', () => {
  const pair = () =>
    createBoxFetcher({
      baseUrl: 'https://box1.example.test',
      fallbackUrl: 'https://box2.example.test',
      token: 'secret-token',
      log: silentLog,
    })

  it('stays on the first box when it answers, even with an error', async () => {
    const calls = stubFetch(() => Response.json({ error: 'busy' }, { status: 429 }))
    const res = await pair().fetch(new Request('http://container/render', { method: 'POST' }))
    expect(res.status).toBe(429)
    expect(calls.map((c) => c.url)).toEqual(['https://box1.example.test/render'])
  })

  it.each([502, 530])('moves to the second box when the first is down (%i)', async (status) => {
    const responses = [new Response('down', { status }), new Response('ok')]
    const calls = stubFetch(() => responses.shift()!)
    const res = await pair().fetch(
      new Request('http://container/transcript', { method: 'POST', body: '{"videoId":"x"}' }),
    )
    expect(res.status).toBe(200)
    expect(calls.map((c) => c.url)).toEqual([
      'https://box1.example.test/transcript',
      'https://box2.example.test/transcript',
    ])
    expect(new TextDecoder().decode(calls[1]!.init.body as ArrayBuffer)).toBe('{"videoId":"x"}')
    expect(calls[1]!.init.headers.get('authorization')).toBe('Bearer secret-token')
  })

  it('moves to the second box when the first is unreachable', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('connection refused'))
      .mockResolvedValueOnce(new Response('ok'))
    vi.stubGlobal('fetch', fetchMock)
    const res = await pair().fetch(new Request('http://container/health'))
    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('never re-sends a timed out request, which may still be rendering', async () => {
    const timeout = new DOMException('timed out', 'TimeoutError')
    const fetchMock = vi.fn().mockRejectedValue(timeout)
    vi.stubGlobal('fetch', fetchMock)
    await expect(pair().fetch(new Request('http://container/render'))).rejects.toBe(timeout)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('returns the last down response when both boxes are down', async () => {
    stubFetch(() => new Response('down', { status: 530 }))
    const res = await pair().fetch(new Request('http://container/health'))
    expect(res.status).toBe(530)
  })
})

describe('box busy responses through the container client', () => {
  const input = {
    jobId: 'j',
    script: {},
    title: 't',
    sourceLabel: 'GitHub',
    imageUrls: [],
    voice: 'v',
    source: null,
    canonicalUrl: 'https://example.com',
    sourceImageUrls: [],
    images: [],
  }

  it.each([
    [429, { error: 'busy' }],
    [409, { error: 'busy' }],
    [429, null],
    [524, null],
  ])('maps %i to a busy render error', async (status, payload) => {
    stubFetch(() => Response.json(payload, { status }))
    const client = createContainerClient(box(), silentLog)
    await expect(client.render(input)).rejects.toMatchObject({ code: 'busy' })
  })

  it('keeps a 502 as an ordinary unreachable failure', async () => {
    stubFetch(() => new Response('bad gateway', { status: 502 }))
    const client = createContainerClient(box(), silentLog)
    await expect(client.render(input)).rejects.toMatchObject({ code: 'container_unreachable' })
  })
})
