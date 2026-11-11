import { describe, expect, it, vi } from 'vitest'
import {
  createBoxPower,
  isBoxDownResponse,
  parseBoxHealth,
  parsePowerState,
  pauseIdleBox,
  shouldPause,
} from './box-power'
import { createBoxFetcher } from './box-fetcher'
import { createContainerClient } from './container-client'
import { RenderJobError } from './errors'
import { silentLog } from './testing'

type Reply = Response | Error
type Call = { url: string; method: string; auth: string | null }

function fakeFetch(replies: Reply[]) {
  const calls: Call[] = []
  const impl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      auth: new Headers(init?.headers).get('authorization'),
    })
    const next = replies.shift() ?? new Response('{}')
    if (next instanceof Error) throw next
    return next
  })
  return { calls, impl: impl as unknown as typeof fetch }
}

const state = (paused: boolean) =>
  Response.json({ data: { deployment: { instances: paused ? 0 : 1 } } })
const SERVICE = 'https://api.northflank.com/v1/projects/proj/services/svc'

function power(replies: Reply[], now = () => 0) {
  const f = fakeFetch(replies)
  const p = createBoxPower({
    apiToken: 'nf-token',
    projectId: 'proj',
    serviceId: 'svc',
    log: silentLog,
    fetch: f.impl,
    now,
  })
  return { p, calls: f.calls }
}

describe('parsePowerState', () => {
  it('reads deployment.instances (0 once paused)', () => {
    expect(parsePowerState({ data: { deployment: { instances: 0 } } })).toBe('paused')
    expect(parsePowerState({ data: { deployment: { instances: 1 } } })).toBe('running')
  })

  it('is unknown for anything else', () => {
    expect(parsePowerState(null)).toBe('unknown')
    expect(parsePowerState({ data: {} })).toBe('unknown')
    expect(parsePowerState({ data: 'x' })).toBe('unknown')
  })
})

describe('createBoxPower', () => {
  it('status calls the service endpoint with the api token', async () => {
    const { p, calls } = power([state(true)])
    expect(await p.status()).toBe('paused')
    expect(calls).toEqual([{ url: SERVICE, method: 'GET', auth: 'Bearer nf-token' }])
  })

  it('status is unknown on http errors and network failures', async () => {
    expect(await power([new Response('no', { status: 500 })]).p.status()).toBe('unknown')
    expect(await power([new Error('offline')]).p.status()).toBe('unknown')
  })

  it('resume posts to /resume when the service is paused', async () => {
    const { p, calls } = power([state(true), Response.json({ data: {} })])
    expect(await p.resume()).toBe('requested')
    expect(calls.map((c) => `${c.method} ${c.url.replace(SERVICE, '')}`)).toEqual([
      'GET ',
      'POST /resume',
    ])
  })

  it('resume does nothing when the service is already running', async () => {
    const { p, calls } = power([state(false)])
    expect(await p.resume()).toBe('already_running')
    expect(calls).toHaveLength(1)
  })

  it('resume is debounced inside the cooldown and retried after it', async () => {
    let t = 0
    const { p, calls } = power(
      [state(true), Response.json({}), state(true), Response.json({})],
      () => t,
    )
    expect(await p.resume()).toBe('requested')
    t = 10_000
    expect(await p.resume()).toBe('skipped')
    expect(calls).toHaveLength(2)
    t = 61_000
    expect(await p.resume()).toBe('requested')
    expect(calls).toHaveLength(4)
  })

  it('a failed resume can be retried straight away', async () => {
    const { p } = power([
      state(true),
      new Response('x', { status: 500 }),
      state(true),
      Response.json({}),
    ])
    expect(await p.resume()).toBe('failed')
    expect(await p.resume()).toBe('requested')
  })

  it('pause posts to /pause and reports the outcome', async () => {
    const ok = power([Response.json({})])
    expect(await ok.p.pause()).toBe(true)
    expect(ok.calls[0]).toMatchObject({ method: 'POST', url: `${SERVICE}/pause` })
    expect(await power([new Response('x', { status: 403 })]).p.pause()).toBe(false)
    expect(await power([new Error('offline')]).p.pause()).toBe(false)
  })
})

describe('pause decision', () => {
  it('parses health and rejects partial bodies', () => {
    expect(parseBoxHealth({ ok: true, running: 0, inflight: 0, idleSeconds: 5 })).toEqual({
      running: 0,
      inflight: 0,
      idleSeconds: 5,
    })
    expect(parseBoxHealth({ ok: true, running: 0 })).toBeNull()
    expect(parseBoxHealth('x')).toBeNull()
  })

  it('pauses only when nothing runs and the idle threshold is reached', () => {
    expect(shouldPause({ running: 0, inflight: 0, idleSeconds: 600 })).toBe(true)
    expect(shouldPause({ running: 0, inflight: 0, idleSeconds: 599 })).toBe(false)
    expect(shouldPause({ running: 1, inflight: 1, idleSeconds: 9999 })).toBe(false)
    expect(shouldPause({ running: 0, inflight: 1, idleSeconds: 9999 })).toBe(false)
    expect(shouldPause(null)).toBe(false)
  })

  const idle = Response.json({ ok: true, running: 0, inflight: 0, idleSeconds: 700 })

  it('pauseIdleBox pauses an idle box using the open health endpoint', async () => {
    const pause = vi.fn(async () => true)
    const f = fakeFetch([idle])
    const out = await pauseIdleBox({
      boxUrl: 'https://box.test',
      power: { pause },
      log: silentLog,
      fetch: f.impl,
    })
    expect(out).toBe('paused')
    expect(f.calls[0]).toEqual({ url: 'https://box.test/health', method: 'GET', auth: null })
    expect(pause).toHaveBeenCalledOnce()
  })

  it('pauseIdleBox leaves a busy, unreachable or unhealthy box alone', async () => {
    for (const reply of [
      Response.json({ ok: true, running: 1, inflight: 1, idleSeconds: 0 }),
      new Response('bad gateway', { status: 502 }),
      new Error('connection refused'),
    ]) {
      const pause = vi.fn(async () => true)
      await pauseIdleBox({
        boxUrl: 'https://box.test',
        power: { pause },
        log: silentLog,
        fetch: fakeFetch([reply]).impl,
      })
      expect(pause).not.toHaveBeenCalled()
    }
  })
})

describe('box fetcher wake-up', () => {
  const stub = (replies: Reply[]) => {
    const f = fakeFetch(replies)
    vi.stubGlobal('fetch', f.impl)
    return f
  }
  const wired = (resume = vi.fn(async () => 'requested' as const)) => ({
    resume,
    box: createBoxFetcher({
      baseUrl: 'https://box.test',
      token: 't',
      log: silentLog,
      power: { resume },
    }),
  })

  it('classifies only non-json gateway errors as the box being down', () => {
    expect(isBoxDownResponse(new Response('x', { status: 503 }))).toBe(true)
    expect(isBoxDownResponse(Response.json({ reason: 'x' }, { status: 502 }))).toBe(false)
    expect(isBoxDownResponse(new Response('x', { status: 500 }))).toBe(false)
  })

  it('a paused box (503) triggers resume and reads as busy so the job is deferred', async () => {
    stub([new Response('service unavailable', { status: 503 })])
    const { box, resume } = wired()
    const client = createContainerClient(box, silentLog)
    await expect(client.download('job-abcdefgh', 'video')).rejects.toMatchObject({ code: 'busy' })
    expect(resume).toHaveBeenCalledOnce()
    vi.unstubAllGlobals()
  })

  it('a connection failure triggers resume and reads as busy', async () => {
    stub([new TypeError('fetch failed')])
    const { box, resume } = wired()
    const res = await box.fetch(new Request('http://container/health'))
    expect(res.status).toBe(429)
    expect(resume).toHaveBeenCalledOnce()
    vi.unstubAllGlobals()
  })

  it('a render timeout is not a wake-up signal', async () => {
    stub([new DOMException('timed out', 'TimeoutError')])
    const { box, resume } = wired()
    await expect(box.fetch(new Request('http://container/render'))).rejects.toThrow()
    expect(resume).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('healthy and json error responses pass through without resuming', async () => {
    stub([new Response('ok'), Response.json({ error: 'x' }, { status: 502 })])
    const { box, resume } = wired()
    expect((await box.fetch(new Request('http://container/health'))).status).toBe(200)
    expect((await box.fetch(new Request('http://container/youtube/search'))).status).toBe(502)
    expect(resume).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('without a power controller a connection failure still throws', async () => {
    stub([new TypeError('fetch failed')])
    const box = createBoxFetcher({ baseUrl: 'https://box.test', token: 't', log: silentLog })
    await expect(box.fetch(new Request('http://container/health'))).rejects.toThrow()
    vi.unstubAllGlobals()
  })

  it('RenderJobError is what the consumer sees for a paused box', () => {
    expect(new RenderJobError('busy', 'x').code).toBe('busy')
  })
})
