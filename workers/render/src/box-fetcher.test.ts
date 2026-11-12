import { afterEach, describe, expect, it, vi } from 'vitest'
import { boxOrder, createBoxFetcher, parseBoxUrls } from './box-fetcher'
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
  createBoxFetcher({
    baseUrls: ['https://box.example.test'],
    token: 'secret-token',
    log: silentLog,
  })

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

const B1 = 'https://box1.example.test'
const B2 = 'https://box2.example.test'
const pair = () => createBoxFetcher({ baseUrls: [B1, B2], token: 'secret-token', log: silentLog })

function jobOnBox(index: number): string {
  for (let i = 0; i < 1000; i++) {
    const id = `job-${i}`
    if (boxOrder([B1, B2], id)[0] === (index === 0 ? B1 : B2)) return id
  }
  throw new Error('no job id found')
}

const renderRequest = (jobId: string) =>
  new Request('http://container/render', {
    method: 'POST',
    body: JSON.stringify({ jobId }),
  })

const isProbe = (url: string, init?: RequestInit) =>
  (init?.method ?? 'GET') === 'GET' && /\/render\/[^/]+$/.test(new URL(url).pathname)

/** Answers job-state probes from `held` (box origin → state, default absent); other calls in order. */
function sequence(...responses: (Response | Error)[]) {
  return sequenceWith({}, ...responses)
}

function sequenceWith(held: Record<string, string>, ...responses: (Response | Error)[]) {
  const calls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: URL | string, init?: RequestInit) => {
      if (isProbe(String(url), init)) {
        return Response.json({ state: held[new URL(String(url)).origin] ?? 'absent' })
      }
      calls.push(String(url))
      const next = responses.shift()!
      if (next instanceof Error) throw next
      return next
    }),
  )
  return calls
}

describe('parseBoxUrls and boxOrder', () => {
  it('splits, trims and drops empties', () => {
    expect(parseBoxUrls(' https://a.test, ,https://b.test ')).toEqual([
      'https://a.test',
      'https://b.test',
    ])
    expect(parseBoxUrls(undefined)).toEqual([])
  })

  it('is deterministic, keeps every box once and uses both boxes as first choice', () => {
    expect(boxOrder([B1, B2], 'abc')).toEqual(boxOrder([B1, B2], 'abc'))
    expect([...boxOrder([B1, B2], 'abc')].sort()).toEqual([B1, B2])
    const firsts = new Set(Array.from({ length: 50 }, (_, i) => boxOrder([B1, B2], `j${i}`)[0]))
    expect(firsts.size).toBe(2)
  })
})

describe('POST /render routing', () => {
  it('starts on the box the job id hashes to', async () => {
    const calls = sequence(Response.json({ ok: 1 }))
    await pair().fetch(renderRequest(jobOnBox(1)))
    expect(calls).toEqual([`${B2}/render`])
  })

  it('moves on when the first box is busy with another job', async () => {
    const calls = sequence(Response.json({ error: 'busy' }, { status: 429 }), Response.json({}))
    const res = await pair().fetch(renderRequest(jobOnBox(0)))
    expect(res.status).toBe(200)
    expect(calls).toEqual([`${B1}/render`, `${B2}/render`])
  })

  it.each([502, 503, 504, 530])('moves on when the first box is down (%i)', async (status) => {
    const calls = sequence(new Response('down', { status }), Response.json({}))
    const res = await pair().fetch(renderRequest(jobOnBox(0)))
    expect(res.status).toBe(200)
    expect(calls).toHaveLength(2)
  })

  it('moves on when the first box is unreachable', async () => {
    const calls = sequence(new TypeError('connection refused'), Response.json({}))
    const res = await pair().fetch(renderRequest(jobOnBox(0)))
    expect(res.status).toBe(200)
    expect(calls).toHaveLength(2)
  })

  it('stops on in_progress: the job is running on that box', async () => {
    const calls = sequence(Response.json({ error: 'in_progress' }, { status: 409 }))
    const res = await pair().fetch(renderRequest(jobOnBox(0)))
    expect(res.status).toBe(409)
    expect(calls).toHaveLength(1)
  })

  it('stops on 524: the render started there', async () => {
    const calls = sequence(new Response('timeout', { status: 524 }))
    const res = await pair().fetch(renderRequest(jobOnBox(0)))
    expect(res.status).toBe(524)
    expect(calls).toHaveLength(1)
  })

  it('stops on any other answer', async () => {
    const calls = sequence(Response.json({ error: 'invalid_input' }, { status: 400 }))
    const res = await pair().fetch(renderRequest(jobOnBox(0)))
    expect(res.status).toBe(400)
    expect(calls).toHaveLength(1)
  })

  it('never fails over on a timeout', async () => {
    const timeout = new DOMException('timed out', 'TimeoutError')
    const calls = sequence(timeout as unknown as Error)
    await expect(pair().fetch(renderRequest(jobOnBox(0)))).rejects.toBe(timeout)
    expect(calls).toHaveLength(1)
  })

  it('returns the busy answer when one box is busy and the other down', async () => {
    sequence(
      new Response('down', { status: 530 }),
      Response.json({ error: 'busy' }, { status: 429 }),
    )
    const res = await pair().fetch(renderRequest(jobOnBox(0)))
    expect(res.status).toBe(429)
  })

  it('returns the down answer when every box is down', async () => {
    sequence(new Response('down', { status: 530 }), new Response('down', { status: 502 }))
    const res = await pair().fetch(renderRequest(jobOnBox(0)))
    expect([502, 530]).toContain(res.status)
  })

  it('forwards the body and token to the second box', async () => {
    const calls: { body: unknown; auth: string | null }[] = []
    const responses = [Response.json({ error: 'busy' }, { status: 429 }), Response.json({})]
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: URL, init: RequestInit & { headers: Headers }) => {
        if (isProbe(String(url), init)) return Response.json({ state: 'absent' })
        calls.push({
          body: new TextDecoder().decode(init.body as ArrayBuffer),
          auth: init.headers.get('authorization'),
        })
        return responses.shift()!
      }),
    )
    const id = jobOnBox(0)
    await pair().fetch(renderRequest(id))
    expect(calls[1]).toEqual({ body: JSON.stringify({ jobId: id }), auth: 'Bearer secret-token' })
  })
})

describe('no duplicate renders across boxes', () => {
  it('sends a re-check to the box already running the job, even when its first box is free', async () => {
    const id = jobOnBox(0)
    const calls = sequenceWith(
      { [B2]: 'running' },
      Response.json({ error: 'in_progress' }, { status: 409 }),
    )
    const res = await pair().fetch(renderRequest(id))
    expect(res.status).toBe(409)
    expect(calls).toEqual([`${B2}/render`])
  })

  it('collects a finished job from the box that rendered it', async () => {
    const calls = sequenceWith({ [B2]: 'done' }, Response.json({ jobId: 'x' }))
    await pair().fetch(renderRequest(jobOnBox(0)))
    expect(calls).toEqual([`${B2}/render`])
  })

  it('falls back to hash order when probes fail or the box predates the state endpoint', async () => {
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: URL | string, init?: RequestInit) => {
        if (isProbe(String(url), init)) return new Response('not found', { status: 404 })
        calls.push(String(url))
        return Response.json({})
      }),
    )
    await pair().fetch(renderRequest(jobOnBox(1)))
    expect(calls).toEqual([`${B2}/render`])
  })
})

describe('render asset lookups', () => {
  const asset = (id: string, method = 'GET') =>
    new Request(`http://container/render/${id}/video`, { method })

  it('moves on when the first box answers 404', async () => {
    const calls = sequence(
      Response.json({ error: 'not_found' }, { status: 404 }),
      new Response('v'),
    )
    const res = await pair().fetch(asset(jobOnBox(0)))
    expect(res.status).toBe(200)
    expect(calls).toEqual([
      `${B1}/render/${jobOnBox(0)}/video`,
      `${B2}/render/${jobOnBox(0)}/video`,
    ])
  })

  it('returns the 404 when no box has the job', async () => {
    sequence(new Response('n', { status: 404 }), new Response('n', { status: 404 }))
    expect((await pair().fetch(asset(jobOnBox(1)))).status).toBe(404)
  })

  it('moves on for DELETE when the box is down', async () => {
    const id = jobOnBox(0)
    const calls = sequence(new Response('down', { status: 503 }), Response.json({ deleted: true }))
    const res = await pair().fetch(
      new Request(`http://container/render/${id}`, { method: 'DELETE' }),
    )
    expect(res.status).toBe(200)
    expect(calls).toHaveLength(2)
  })

  it('does not move on for other statuses', async () => {
    const calls = sequence(new Response('v'))
    await pair().fetch(asset(jobOnBox(1)))
    expect(calls).toHaveLength(1)
  })
})

describe('light calls', () => {
  it('try the last box first', async () => {
    const calls = sequence(Response.json({ ok: true }))
    await pair().fetch(new Request('http://container/health'))
    expect(calls).toEqual([`${B2}/health`])
  })

  it('fail over only when the box is down or unreachable', async () => {
    const calls = sequence(
      new TypeError('refused'),
      new Response('d', { status: 530 }),
      new Response('ok'),
    )
    const three = createBoxFetcher({
      baseUrls: [B1, B2, 'https://box3.example.test'],
      token: 't',
      log: silentLog,
    })
    const res = await three.fetch(new Request('http://container/transcript', { method: 'POST' }))
    expect(res.status).toBe(200)
    expect(calls).toHaveLength(3)
  })

  it('treat a busy answer as final', async () => {
    const calls = sequence(Response.json({ error: 'busy' }, { status: 429 }))
    const res = await pair().fetch(new Request('http://container/transcript', { method: 'POST' }))
    expect(res.status).toBe(429)
    expect(calls).toHaveLength(1)
  })

  it('never re-send a timed out request', async () => {
    const timeout = new DOMException('timed out', 'TimeoutError')
    const calls = sequence(timeout as unknown as Error)
    await expect(pair().fetch(new Request('http://container/health'))).rejects.toBe(timeout)
    expect(calls).toHaveLength(1)
  })

  it('throw when there are no boxes', async () => {
    const none = createBoxFetcher({ baseUrls: [], token: 't', log: silentLog })
    await expect(none.fetch(new Request('http://container/health'))).rejects.toThrow(/no render/)
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
    [409, { error: 'in_progress' }],
    [429, null],
    [524, null],
  ])('maps %i to a waiting render error', async (status, payload) => {
    stubFetch(() => Response.json(payload, { status }))
    const client = createContainerClient(box(), silentLog)
    await expect(client.render(input)).rejects.toSatisfy(
      (err: { code: string }) => err.code === 'busy' || err.code === 'in_progress',
    )
  })

  it('keeps a 502 as an ordinary unreachable failure', async () => {
    stubFetch(() => new Response('bad gateway', { status: 502 }))
    const client = createContainerClient(box(), silentLog)
    await expect(client.render(input)).rejects.toMatchObject({ code: 'container_unreachable' })
  })
})
