import { describe, expect, it, vi } from 'vitest'
import {
  checkInstagramAccount,
  connectInstagramAccount,
  workerConfigFromEnv,
} from './worker-client'

const account = {
  username: 'reelset',
  state: 'connected',
  message: null,
  checkedAt: '2026-11-11T00:00:00.000Z',
  loginFailures: 0,
}

describe('workerConfigFromEnv', () => {
  it('needs both url and token', () => {
    expect(workerConfigFromEnv({ IG_ADMIN_URL: 'https://x.app/' })).toBeNull()
    expect(workerConfigFromEnv({ IG_ADMIN_TOKEN: 't' })).toBeNull()
    expect(workerConfigFromEnv({ IG_ADMIN_URL: 'https://x.app/', IG_ADMIN_TOKEN: 't' })).toEqual({
      baseUrl: 'https://x.app',
      token: 't',
    })
  })
})

describe('worker client', () => {
  it('sends the bearer token and the 2FA code', async () => {
    const fetchMock = vi.fn(async () => Response.json(account))
    const result = await connectInstagramAccount(
      {
        baseUrl: 'https://w.app',
        token: 'secret-token',
        fetch: fetchMock as unknown as typeof fetch,
      },
      '123456',
    )
    expect(result).toEqual({ ok: true, value: account })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://w.app/admin/ig/connect')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer secret-token')
    expect(init.body).toBe(JSON.stringify({ code: '123456' }))
  })

  it('reports non-200, bad payloads and network errors without throwing', async () => {
    const cfg = (f: unknown) => ({ baseUrl: 'https://w.app', token: 't', fetch: f as typeof fetch })
    expect(
      await checkInstagramAccount(cfg(async () => new Response('no', { status: 404 }))),
    ).toEqual({
      ok: false,
      message: 'Poster answered 404',
    })
    expect(await checkInstagramAccount(cfg(async () => Response.json({ nope: 1 })))).toMatchObject({
      ok: false,
    })
    expect(
      await checkInstagramAccount(
        cfg(async () => {
          throw new Error('boom')
        }),
      ),
    ).toEqual({ ok: false, message: 'Could not reach the poster' })
  })
})
