import { describe, expect, it, vi } from 'vitest'
import { DetailError, createDetailStore } from './detail-store'

type Detail = { id: string; n: number }

function setup(overrides: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}) {
  let n = 0
  const fetchImpl =
    overrides.fetchImpl ??
    vi.fn(async (url: RequestInfo | URL) => {
      n += 1
      const id = String(url).split('/').pop() ?? ''
      return Response.json({ id, n })
    })
  const clock = { t: 1_000 }
  const store = createDetailStore<Detail>({
    url: (id) => `/api/admin/items/${id}`,
    parse: (json, id) => {
      const value = json as Detail
      if (value?.id !== id) throw new Error('bad')
      return value
    },
    fetchImpl: fetchImpl as typeof fetch,
    now: () => clock.t,
    freshMs: 100,
    maxEntries: 2,
    timeoutMs: overrides.timeoutMs,
  })
  return { store, fetchImpl: fetchImpl as ReturnType<typeof vi.fn>, clock }
}

describe('createDetailStore', () => {
  it('fetches once for concurrent loads and caches the result', async () => {
    const { store, fetchImpl } = setup()
    const [a, b] = await Promise.all([store.load('a'), store.load('a')])
    expect(a).toEqual({ id: 'a', n: 1 })
    expect(b).toBe(a)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(store.peek('a')).toBe(a)
    expect(store.isFresh('a')).toBe(true)
  })

  it('goes stale after the fresh window but keeps the data for display', async () => {
    const { store, clock } = setup()
    await store.load('a')
    clock.t += 500
    expect(store.isFresh('a')).toBe(false)
    expect(store.peek('a')).toBeDefined()
  })

  it('invalidateAll marks entries stale and ignores responses that started before it', async () => {
    const { store } = setup()
    await store.load('a')
    store.invalidateAll()
    expect(store.isFresh('a')).toBe(false)
    const pending = store.load('b')
    store.invalidateAll()
    await pending
    expect(store.isFresh('b')).toBe(false)
  })

  it('evicts the oldest entry beyond the cap', async () => {
    const { store } = setup()
    await store.load('a')
    await store.load('b')
    await store.load('c')
    expect(store.peek('a')).toBeUndefined()
    expect(store.peek('c')).toBeDefined()
  })

  it('aborts the request when the only caller aborts', async () => {
    let signal: AbortSignal | undefined
    const fetchImpl = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          signal = init?.signal ?? undefined
          signal?.addEventListener('abort', () => reject(new DOMException('x', 'AbortError')))
        }),
    )
    const { store } = setup({ fetchImpl: fetchImpl as unknown as typeof fetch })
    const controller = new AbortController()
    const pending = store.load('a', controller.signal)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(signal?.aborted).toBe(true)
  })

  it('keeps a prefetch running when a joined caller aborts', async () => {
    const { store, fetchImpl } = setup()
    store.prefetch('a')
    const controller = new AbortController()
    const pending = store.load('a', controller.signal)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(store.peek('a')).toBeDefined())
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('does not prefetch fresh or in-flight ids', async () => {
    const { store, fetchImpl } = setup()
    store.prefetch('a')
    store.prefetch('a')
    await vi.waitFor(() => expect(store.peek('a')).toBeDefined())
    store.prefetch('a')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('maps HTTP failures and bad payloads to DetailError', async () => {
    const notFound = vi.fn(async () => Response.json({ error: 'not_found' }, { status: 404 }))
    const a = setup({ fetchImpl: notFound as unknown as typeof fetch })
    await expect(a.store.load('x')).rejects.toMatchObject({ status: 404 })

    const wrongShape = vi.fn(async () => Response.json({ id: 'other', n: 1 }))
    const b = setup({ fetchImpl: wrongShape as unknown as typeof fetch })
    await expect(b.store.load('x')).rejects.toBeInstanceOf(DetailError)
    await expect(b.store.load('x')).rejects.toMatchObject({ status: 502 })
  })

  it('times out slow requests', async () => {
    const hang = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('x', 'AbortError')))
        }),
    )
    const { store } = setup({ fetchImpl: hang as unknown as typeof fetch, timeoutMs: 10 })
    await expect(store.load('a')).rejects.toMatchObject({ status: 408 })
  })
})
