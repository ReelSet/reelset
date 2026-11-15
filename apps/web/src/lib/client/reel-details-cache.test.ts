import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReelPageData } from '@/lib/seo/types'
import { loadReelDetails, peekReelDetails, resetReelDetailsCache } from './reel-details-cache'

function reel(id: string): ReelPageData {
  return {
    id,
    visibility: 'public',
    title: id,
    tldr: null,
    hook: null,
    transcript: null,
    topics: [],
    kind: 'video',
    canonicalUrl: 'https://x.test',
    publishedAt: '2026-01-01T00:00:00Z',
    renderedAt: null,
    videoUrl: null,
    posterUrl: null,
    durationMs: null,
    facts: [],
    mentions: [],
  }
}

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })

describe('reel details cache', () => {
  beforeEach(() => resetReelDetailsCache())
  afterEach(() => vi.unstubAllGlobals())

  it('shares one request per id and serves repeats from memory', async () => {
    const fetchMock = vi.fn(async () => ok(reel('a')))
    vi.stubGlobal('fetch', fetchMock)
    const [one, two] = await Promise.all([loadReelDetails('a'), loadReelDetails('a')])
    expect(one?.id).toBe('a')
    expect(two?.id).toBe('a')
    await loadReelDetails('a')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(peekReelDetails('a')?.id).toBe('a')
  })

  it('does not cache failures or mismatched bodies', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 404 })),
    )
    expect(await loadReelDetails('b')).toBeNull()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ok(reel('other'))),
    )
    expect(await loadReelDetails('b')).toBeNull()
    expect(peekReelDetails('b')).toBeUndefined()
  })

  it('aborts the request only when every caller has aborted', async () => {
    let signal: AbortSignal | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => {
        signal = init?.signal ?? undefined
        return new Promise<Response>((_, reject) =>
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))),
        )
      }),
    )
    const first = new AbortController()
    const second = new AbortController()
    const p1 = loadReelDetails('c', first.signal)
    void loadReelDetails('c', second.signal)
    first.abort()
    expect(signal?.aborted).toBe(false)
    second.abort()
    expect(signal?.aborted).toBe(true)
    expect(await p1).toBeNull()
  })
})
