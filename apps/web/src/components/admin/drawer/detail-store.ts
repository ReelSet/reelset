import {
  DRAWER_CACHE_FRESH_MS,
  DRAWER_CACHE_MAX_ENTRIES,
  DRAWER_FETCH_TIMEOUT_MS,
} from '@/lib/admin/drawer-config'

export class DetailError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'DetailError'
  }
}

export type DetailStore<T> = {
  peek(id: string): T | undefined
  isFresh(id: string): boolean
  load(id: string, signal?: AbortSignal): Promise<T>
  prefetch(id: string): void
  invalidateAll(): void
}

type Options<T> = {
  url: (id: string) => string
  parse: (json: unknown, id: string) => T
  fetchImpl?: typeof fetch
  now?: () => number
  freshMs?: number
  maxEntries?: number
  timeoutMs?: number
}

type Entry<T> = { data: T; fetchedAt: number }
type Inflight<T> = { promise: Promise<T>; controller: AbortController; refs: number; keep: boolean }

const abortError = () => new DOMException('Aborted', 'AbortError')

/** In-memory detail cache: dedupes in-flight requests, serves stale data while revalidating. */
export function createDetailStore<T>(options: Options<T>): DetailStore<T> {
  const fetchImpl = options.fetchImpl ?? ((...args) => fetch(...args))
  const now = options.now ?? Date.now
  const freshMs = options.freshMs ?? DRAWER_CACHE_FRESH_MS
  const maxEntries = options.maxEntries ?? DRAWER_CACHE_MAX_ENTRIES
  const timeoutMs = options.timeoutMs ?? DRAWER_FETCH_TIMEOUT_MS
  const entries = new Map<string, Entry<T>>()
  const inflight = new Map<string, Inflight<T>>()
  let epoch = 0

  function remember(id: string, data: T, startedAtEpoch: number) {
    entries.delete(id)
    entries.set(id, { data, fetchedAt: startedAtEpoch === epoch ? now() : 0 })
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next().value
      if (oldest === undefined) break
      entries.delete(oldest)
    }
  }

  async function request(id: string, controller: AbortController, timedOut: () => boolean) {
    try {
      const res = await fetchImpl(options.url(id), {
        signal: controller.signal,
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
      })
      if (!res.ok) throw new DetailError(res.status, `request failed (${res.status})`)
      const json: unknown = await res.json().catch(() => {
        throw new DetailError(502, 'unreadable response')
      })
      try {
        return options.parse(json, id)
      } catch {
        throw new DetailError(502, 'unexpected response shape')
      }
    } catch (err) {
      if (timedOut()) throw new DetailError(408, 'request timed out')
      throw err
    }
  }

  function start(id: string, keep: boolean): Inflight<T> {
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)
    const startedAtEpoch = epoch
    const promise = request(id, controller, () => timedOut)
      .then((data) => {
        remember(id, data, startedAtEpoch)
        return data
      })
      .finally(() => {
        clearTimeout(timer)
        inflight.delete(id)
      })
    const created: Inflight<T> = { promise, controller, refs: 0, keep }
    inflight.set(id, created)
    return created
  }

  function isFresh(id: string): boolean {
    const entry = entries.get(id)
    return entry !== undefined && now() - entry.fetchedAt < freshMs
  }

  return {
    peek: (id) => entries.get(id)?.data,
    isFresh,
    load(id, signal) {
      if (signal?.aborted) return Promise.reject(abortError())
      const shared = inflight.get(id) ?? start(id, false)
      shared.refs += 1
      return new Promise<T>((resolve, reject) => {
        let settled = false
        const onAbort = () => {
          if (settled) return
          settled = true
          shared.refs -= 1
          if (shared.refs <= 0 && !shared.keep) shared.controller.abort()
          reject(abortError())
        }
        signal?.addEventListener('abort', onAbort, { once: true })
        const finish = (settle: () => void) => {
          if (settled) return
          settled = true
          signal?.removeEventListener('abort', onAbort)
          settle()
        }
        shared.promise.then(
          (data) => finish(() => resolve(data)),
          (err: unknown) => finish(() => reject(err)),
        )
      })
    },
    prefetch(id) {
      if (isFresh(id) || inflight.has(id)) return
      start(id, true).promise.catch(() => undefined)
    },
    invalidateAll() {
      epoch += 1
      for (const [id, entry] of entries) entries.set(id, { ...entry, fetchedAt: 0 })
    },
  }
}
