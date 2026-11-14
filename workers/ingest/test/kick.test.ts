import { describe, expect, it, vi } from 'vitest'

const processReelRequests = vi.fn(async () => ({}))
const settleReelRequests = vi.fn(async () => ({}))

vi.mock('../src/generate/process', () => ({ processReelRequests }))
vi.mock('@reelset/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@reelset/core')>()),
  createDb: () => ({ db: {}, close: async () => {} }),
  settleReelRequests,
}))

const { default: worker } = await import('../src/index')

function call(method: string, headers: Record<string, string> = {}) {
  const pending: Promise<unknown>[] = []
  const ctx = { waitUntil: (p: Promise<unknown>) => pending.push(p) }
  const env = {
    SELFCHECK_TOKEN: 'secret',
    HYPERDRIVE: { connectionString: 'x' },
    INGEST_ITEMS: { send: vi.fn() },
  }
  const res = worker.fetch!(
    new Request('https://ingest.test/internal/generate/kick', { method, headers }),
    env as never,
    ctx as never,
  )
  return { res: Promise.resolve(res), pending }
}

describe('POST /internal/generate/kick', () => {
  it('rejects a missing or wrong bearer token without running anything', async () => {
    const bad: Record<string, string>[] = [{}, { authorization: 'Bearer nope' }]
    for (const headers of bad) {
      const { res, pending } = call('POST', headers)
      expect((await res).status).toBe(401)
      expect(pending).toHaveLength(0)
    }
    expect(processReelRequests).not.toHaveBeenCalled()
  })

  it('only accepts POST', async () => {
    const { res } = call('GET', { authorization: 'Bearer secret' })
    expect((await res).status).toBe(405)
    expect(processReelRequests).not.toHaveBeenCalled()
  })

  it('answers 202 and processes requests and settles in the background', async () => {
    const { res, pending } = call('POST', { authorization: 'Bearer secret' })
    expect((await res).status).toBe(202)
    await Promise.all(pending)
    expect(processReelRequests).toHaveBeenCalledTimes(1)
    expect(settleReelRequests).toHaveBeenCalledTimes(1)
  })
})
