import pino from 'pino'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { kickIngest } from './kick'

const log = pino({ level: 'silent' })

describe('kickIngest', () => {
  const fetchMock = vi.fn(async () => new Response(null, { status: 202 }))

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('INGEST_INTERNAL_URL', 'https://ingest.test/')
    vi.stubEnv('INGEST_INTERNAL_TOKEN', 'tok')
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    fetchMock.mockClear()
  })

  it('posts to the public URL without a binding', async () => {
    expect(await kickIngest(log, undefined)).toBe(true)
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(
      'https://ingest.test/internal/generate/kick',
    )
  })

  it('uses the INGEST binding when present, even without a URL', async () => {
    vi.stubEnv('INGEST_INTERNAL_URL', '')
    const binding = { fetch: vi.fn(async () => new Response(null, { status: 202 })) }
    expect(await kickIngest(log, { INGEST: binding })).toBe(true)
    expect((binding.fetch.mock.calls[0] as unknown as [string])[0]).toBe(
      'https://internal/internal/generate/kick',
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('skips when the token is missing', async () => {
    vi.stubEnv('INGEST_INTERNAL_TOKEN', '')
    expect(await kickIngest(log, undefined)).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
