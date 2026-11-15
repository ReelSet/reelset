import type { ReelPageData } from '@/lib/seo/types'

const MAX_ENTRIES = 100

type Inflight = { promise: Promise<ReelPageData | null>; ctl: AbortController; subscribers: number }

const cache = new Map<string, ReelPageData>()
const inflight = new Map<string, Inflight>()

export function peekReelDetails(id: string): ReelPageData | undefined {
  return cache.get(id)
}

function remember(id: string, reel: ReelPageData) {
  cache.delete(id)
  cache.set(id, reel)
  if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value as string)
}

async function fetchReel(id: string, signal: AbortSignal): Promise<ReelPageData | null> {
  try {
    const res = await fetch(`/api/reel/${id}`, { signal })
    if (!res.ok) return null
    const reel = (await res.json()) as ReelPageData
    if (reel?.id !== id) return null
    remember(id, reel)
    return reel
  } catch {
    return null
  }
}

/** Resolves the reel's full details (null on failure); shares one request per id and cancels it once every caller has aborted. */
export function loadReelDetails(id: string, signal?: AbortSignal): Promise<ReelPageData | null> {
  const hit = cache.get(id)
  if (hit) return Promise.resolve(hit)
  if (signal?.aborted) return Promise.resolve(null)

  let entry = inflight.get(id)
  if (!entry) {
    const ctl = new AbortController()
    const promise = fetchReel(id, ctl.signal).finally(() => {
      if (inflight.get(id) === created) inflight.delete(id)
    })
    const created: Inflight = { promise, ctl, subscribers: 0 }
    inflight.set(id, created)
    entry = created
  }

  const shared = entry
  shared.subscribers += 1
  signal?.addEventListener(
    'abort',
    () => {
      shared.subscribers -= 1
      if (shared.subscribers > 0) return
      shared.ctl.abort()
      if (inflight.get(id) === shared) inflight.delete(id)
    },
    { once: true },
  )
  return shared.promise
}

export function resetReelDetailsCache() {
  cache.clear()
  inflight.clear()
}
