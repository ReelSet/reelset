import { describe, expect, it } from 'vitest'
import type { ContainerFetcher } from './container-client'
import { handleTranscript, handleYoutubeSearch, matchRoute } from './routes'
import { silentLog } from './testing'

describe('matchRoute', () => {
  it('only accepts POST /transcript and POST /youtube/search', () => {
    expect(matchRoute('POST', '/transcript')).toBe('transcript')
    expect(matchRoute('POST', '/youtube/search')).toBe('youtube_search')
    for (const [method, path] of [
      ['GET', '/transcript'],
      ['PUT', '/transcript'],
      ['GET', '/youtube/search'],
      ['PUT', '/youtube/search'],
      ['POST', '/youtube/search/'],
      ['POST', '/youtube'],
      ['POST', '/transcript/'],
      ['POST', '/render'],
      ['POST', '/'],
      ['GET', '/health'],
    ] as const) {
      expect(matchRoute(method, path)).toBe('not_found')
    }
  })
})

function post(body: unknown) {
  return new Request('https://render.internal/transcript', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

describe('handleTranscript', () => {
  const ok = { status: 'ok', language: 'en', segments: [{ text: 'hi', start: 0, duration: 2.1 }] }

  it('forwards a valid video id and returns the container result', async () => {
    let forwarded: unknown
    const container: ContainerFetcher = {
      fetch: async (req) => {
        forwarded = { url: req.url, body: await req.json() }
        return Response.json(ok)
      },
    }
    const res = await handleTranscript(post({ videoId: 'dQw4w9WgXcQ' }), container, silentLog)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(ok)
    expect(forwarded).toEqual({
      url: 'http://container/transcript',
      body: { videoId: 'dQw4w9WgXcQ' },
    })
  })

  it('passes through unavailable reasons', async () => {
    const container: ContainerFetcher = {
      fetch: async () => Response.json({ status: 'unavailable', reason: 'blocked' }),
    }
    const res = await handleTranscript(post({ videoId: 'dQw4w9WgXcQ' }), container, silentLog)
    expect(await res.json()).toEqual({ status: 'unavailable', reason: 'blocked' })
  })

  it('rejects bad bodies with 400 and never calls the container', async () => {
    let called = false
    const container: ContainerFetcher = {
      fetch: async () => {
        called = true
        return Response.json(ok)
      },
    }
    for (const body of [{ videoId: 'short' }, {}, 'not json', { videoId: 'dQw4w9WgXcQ/../x' }]) {
      const res = await handleTranscript(post(body), container, silentLog)
      expect(res.status).toBe(400)
    }
    expect(called).toBe(false)
  })

  it('answers 503 when the container fails or answers garbage', async () => {
    const cases: ContainerFetcher[] = [
      {
        fetch: async () => {
          throw new Error('down')
        },
      },
      { fetch: async () => new Response('x', { status: 500 }) },
      { fetch: async () => Response.json({ status: 'weird' }) },
    ]
    for (const container of cases) {
      const res = await handleTranscript(post({ videoId: 'dQw4w9WgXcQ' }), container, silentLog)
      expect(res.status).toBe(503)
    }
  })

  it('keeps 200 unavailable/error when the library reports error', async () => {
    const container: ContainerFetcher = {
      fetch: async () => Response.json({ status: 'unavailable', reason: 'error' }),
    }
    const res = await handleTranscript(post({ videoId: 'dQw4w9WgXcQ' }), container, silentLog)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'unavailable', reason: 'error' })
  })
})

function search(body: unknown) {
  return new Request('https://render.internal/youtube/search', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

describe('handleYoutubeSearch', () => {
  const valid = { queries: ['open source ai'], maxAgeDays: 14, perQueryLimit: 5 }
  const video = {
    videoId: 'dQw4w9WgXcQ',
    title: 't',
    channelName: 'c',
    channelId: 'UC1',
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    publishedAt: '2026-11-08T00:00:21Z',
    viewCount: 10,
    durationSec: null,
    description: '',
    thumbnailUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
  }
  const ok = { status: 'ok', videos: [video], failedQueries: ['x'] }

  it('forwards a valid request to /youtube/search and returns the result', async () => {
    let forwarded: unknown
    const container: ContainerFetcher = {
      fetch: async (req) => {
        forwarded = { url: req.url, body: await req.json() }
        return Response.json(ok)
      },
    }
    const res = await handleYoutubeSearch(search(valid), container, silentLog)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(ok)
    expect(forwarded).toEqual({ url: 'http://container/youtube/search', body: valid })
  })

  it('rejects bad bodies with 400 and never calls the container', async () => {
    let called = false
    const container: ContainerFetcher = {
      fetch: async () => {
        called = true
        return Response.json(ok)
      },
    }
    const bad = [
      'not json',
      {},
      { ...valid, queries: [] },
      { ...valid, queries: Array(31).fill('ab') },
      { ...valid, queries: ['a'] },
      { ...valid, queries: ['x'.repeat(101)] },
      { ...valid, maxAgeDays: 0 },
      { ...valid, maxAgeDays: 31 },
      { ...valid, maxAgeDays: 1.5 },
      { ...valid, perQueryLimit: 21 },
      { ...valid, perQueryLimit: 0 },
    ]
    for (const body of bad) {
      const res = await handleYoutubeSearch(search(body), container, silentLog)
      expect(res.status).toBe(400)
    }
    expect(called).toBe(false)
  })

  it('passes a total search failure through as 502', async () => {
    const container: ContainerFetcher = {
      fetch: async () =>
        Response.json({ status: 'error', reason: 'all 1 queries failed' }, { status: 502 }),
    }
    const res = await handleYoutubeSearch(search(valid), container, silentLog)
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ status: 'error', reason: 'all 1 queries failed' })
  })

  it('answers 503 when the container is down, errors or answers garbage', async () => {
    const cases: ContainerFetcher[] = [
      {
        fetch: async () => {
          throw new Error('down')
        },
      },
      { fetch: async () => new Response('x', { status: 500 }) },
      { fetch: async () => Response.json({ status: 'weird' }) },
    ]
    for (const container of cases) {
      const res = await handleYoutubeSearch(search(valid), container, silentLog)
      expect(res.status).toBe(503)
    }
  })
})
